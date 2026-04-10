//! In-process WebSocket party coordination server (same JSON protocol as `party-server/`).

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::Message;

const PROTOCOL_VERSION: i64 = 1;
const MAX_QUEUE: usize = 100;
const MAX_LOBBIES: usize = 500;
const MAX_MEMBERS_PER_LOBBY: usize = 16;
const RATE_WINDOW: Duration = Duration::from_secs(60);
const RATE_MAX: u32 = 120;
const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

struct RunningServer {
    port: u16,
    shutdown: tokio::sync::broadcast::Sender<()>,
}

static EMBEDDED: Mutex<Option<RunningServer>> = Mutex::new(None);

#[derive(Clone)]
struct Member {
    display_name: String,
    tx: mpsc::UnboundedSender<Message>,
}

struct QueueEntry {
    seq: u64,
    set_id: i64,
    no_video: bool,
    artist: Option<String>,
    title: Option<String>,
    creator: Option<String>,
    cover_url: Option<Value>,
    from_member_id: String,
}

struct Lobby {
    code: String,
    leader_id: String,
    members: HashMap<String, Member>,
    member_order: Vec<String>,
    queue: Vec<QueueEntry>,
    next_seq: u64,
}

impl Lobby {
    fn add_member(&mut self, id: String, display_name: String, tx: mpsc::UnboundedSender<Message>) {
        self.members.insert(
            id.clone(),
            Member {
                display_name,
                tx,
            },
        );
        if !self.member_order.contains(&id) {
            self.member_order.push(id);
        }
    }

    fn remove_member(&mut self, id: &str) {
        self.members.remove(id);
        self.member_order.retain(|x| x != id);
        if self.leader_id == id {
            self.leader_id = self.member_order.first().cloned().unwrap_or_default();
        }
    }

    fn to_public_members(&self) -> Vec<Value> {
        self.member_order
            .iter()
            .filter(|id| self.members.contains_key(*id))
            .map(|id| {
                let m = self.members.get(id).unwrap();
                json!({
                    "id": id,
                    "displayName": m.display_name,
                })
            })
            .collect()
    }

    fn broadcast_all(&self, v: &Value) {
        let s = v.to_string();
        for m in self.members.values() {
            let _ = m.tx.send(Message::Text(s.clone().into()));
        }
    }
}

struct ServerState {
    lobbies: HashMap<String, Lobby>,
    rate: HashMap<String, (Instant, u32)>,
}

impl ServerState {
    fn new() -> Self {
        Self {
            lobbies: HashMap::new(),
            rate: HashMap::new(),
        }
    }

    fn check_rate(&mut self, ip: &str) -> bool {
        let now = Instant::now();
        let e = self.rate.entry(ip.to_string()).or_insert((now, 0));
        if now.duration_since(e.0) > RATE_WINDOW {
            *e = (now, 0);
        }
        e.1 += 1;
        e.1 <= RATE_MAX
    }

    fn gen_code(&mut self) -> String {
        loop {
            let mut s = String::with_capacity(6);
            for _ in 0..6 {
                let i = rand::random::<usize>() % CROCKFORD.len();
                s.push(CROCKFORD[i] as char);
            }
            if !self.lobbies.contains_key(&s) {
                return s;
            }
        }
    }

    fn prune_if_needed(&mut self) {
        if self.lobbies.len() <= MAX_LOBBIES {
            return;
        }
        let empty: Vec<String> = self
            .lobbies
            .iter()
            .filter(|(_, l)| l.members.is_empty())
            .map(|(c, _)| c.clone())
            .collect();
        for c in empty {
            self.lobbies.remove(&c);
        }
    }
}

fn gen_member_id() -> String {
    let b: [u8; 16] = rand::random();
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn send_raw(tx: &mpsc::UnboundedSender<Message>, v: &Value) {
    let _ = tx.send(Message::Text(v.to_string().into()));
}

async fn handle_connection(
    stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    peer: SocketAddr,
    state: Arc<RwLock<ServerState>>,
    mut shutdown: tokio::sync::broadcast::Receiver<()>,
) {
    let (mut write, mut read) = stream.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();
    let ip = peer.ip().to_string();

    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut meta: Option<(String, String)> = None;

    loop {
        tokio::select! {
            _ = shutdown.recv() => break,
            incoming = read.next() => {
                let Some(incoming) = incoming else { break };
                let Ok(msg) = incoming else { break };
                match msg {
                    Message::Text(t) => {
                        let s = t.to_string();
                        process_text(&s, &mut meta, &state, &out_tx, &ip).await;
                    }
                    Message::Close(_) => break,
                    Message::Ping(p) => {
                        let _ = out_tx.send(Message::Pong(p));
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some((code, mid)) = meta.take() {
        let mut st = state.write().await;
        if let Some(lobby) = st.lobbies.get_mut(&code) {
            lobby.remove_member(&mid);
            if lobby.members.is_empty() {
                st.lobbies.remove(&code);
            } else {
                let roster = json!({
                    "type": "roster",
                    "v": PROTOCOL_VERSION,
                    "leaderId": lobby.leader_id,
                    "members": lobby.to_public_members(),
                    "seq": lobby.next_seq,
                });
                lobby.broadcast_all(&roster);
            }
        }
    }

    drop(out_tx);
    let _ = writer.await;
}

async fn process_text(
    text: &str,
    meta: &mut Option<(String, String)>,
    state: &Arc<RwLock<ServerState>>,
    out_tx: &mpsc::UnboundedSender<Message>,
    ip: &str,
) {
    let Ok(data) = serde_json::from_str::<Value>(text) else {
        send_raw(
            out_tx,
            &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Invalid JSON"}),
        );
        return;
    };
    if data.get("v").and_then(|x| x.as_i64()) != Some(PROTOCOL_VERSION) {
        send_raw(
            out_tx,
            &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Unsupported protocol version"}),
        );
        return;
    }
    let Some(typ) = data.get("type").and_then(|x| x.as_str()) else {
        send_raw(
            out_tx,
            &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Missing type"}),
        );
        return;
    };

    if typ == "create_lobby" {
        let mut st = state.write().await;
        if !st.check_rate(ip) {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Rate limited"}),
            );
            return;
        }
        if meta.is_some() {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Already in a lobby"}),
            );
            return;
        }
        if st.lobbies.len() >= MAX_LOBBIES {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Server busy — try again later"}),
            );
            return;
        }
        let display_name = data
            .get("displayName")
            .and_then(|x| x.as_str())
            .unwrap_or("Host")
            .to_string();
        let display_name = if display_name.is_empty() {
            "Host".into()
        } else {
            display_name
        };
        let member_id = gen_member_id();
        let code = st.gen_code();
        let mut lobby = Lobby {
            code: code.clone(),
            leader_id: member_id.clone(),
            members: HashMap::new(),
            member_order: Vec::new(),
            queue: Vec::new(),
            next_seq: 1,
        };
        lobby.add_member(member_id.clone(), display_name, out_tx.clone());
        st.lobbies.insert(code.clone(), lobby);
        st.prune_if_needed();
        *meta = Some((code.clone(), member_id.clone()));
        let lobby = st.lobbies.get(&code).unwrap();
        let welcome = json!({
            "type": "welcome",
            "v": PROTOCOL_VERSION,
            "selfId": member_id,
            "lobbyCode": code,
            "leaderId": lobby.leader_id,
            "members": lobby.to_public_members(),
            "queued": lobby.queue.iter().map(queue_to_json).collect::<Vec<_>>(),
            "seq": lobby.next_seq - 1,
        });
        send_raw(out_tx, &welcome);
        return;
    }

    if typ == "join_lobby" {
        let mut st = state.write().await;
        if !st.check_rate(ip) {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Rate limited"}),
            );
            return;
        }
        if meta.is_some() {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Already in a lobby"}),
            );
            return;
        }
        let raw_code = data.get("code").and_then(|x| x.as_str()).unwrap_or("");
        let code: String = raw_code
            .to_uppercase()
            .chars()
            .filter(|c| matches!(c, '0'..='9' | 'A'..='Z') && *c != 'I' && *c != 'L' && *c != 'O' && *c != 'U')
            .collect();
        if code.len() < 4 {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Invalid lobby code"}),
            );
            return;
        }
        let Some(lobby) = st.lobbies.get_mut(&code) else {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Lobby not found"}),
            );
            return;
        };
        if lobby.members.len() >= MAX_MEMBERS_PER_LOBBY {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Lobby is full"}),
            );
            return;
        }
        let display_name = data
            .get("displayName")
            .and_then(|x| x.as_str())
            .unwrap_or("Player")
            .to_string();
        let display_name = if display_name.is_empty() {
            "Player".into()
        } else {
            display_name
        };
        let member_id = gen_member_id();
        lobby.add_member(member_id.clone(), display_name, out_tx.clone());
        *meta = Some((code.clone(), member_id.clone()));

        let welcome = json!({
            "type": "welcome",
            "v": PROTOCOL_VERSION,
            "selfId": member_id,
            "lobbyCode": code,
            "leaderId": lobby.leader_id,
            "members": lobby.to_public_members(),
            "queued": lobby.queue.iter().map(queue_to_json).collect::<Vec<_>>(),
            "seq": lobby.next_seq - 1,
        });
        send_raw(out_tx, &welcome);

        let roster = json!({
            "type": "roster",
            "v": PROTOCOL_VERSION,
            "leaderId": lobby.leader_id,
            "members": lobby.to_public_members(),
            "seq": lobby.next_seq,
        });
        for (id, m) in &lobby.members {
            if id == &member_id {
                continue;
            }
            let _ = m.tx.send(Message::Text(roster.to_string().into()));
        }
        return;
    }

    let Some((lobby_code, member_id)) = meta.clone() else {
        send_raw(
            out_tx,
            &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Join or create a lobby first"}),
        );
        return;
    };

    let mut st = state.write().await;
    let Some(lobby) = st.lobbies.get_mut(&lobby_code) else {
        *meta = None;
        send_raw(
            out_tx,
            &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Lobby no longer exists"}),
        );
        return;
    };

    if typ == "leave_lobby" {
        lobby.remove_member(&member_id);
        *meta = None;
        if lobby.members.is_empty() {
            st.lobbies.remove(&lobby_code);
        } else {
            let roster = json!({
                "type": "roster",
                "v": PROTOCOL_VERSION,
                "leaderId": lobby.leader_id,
                "members": lobby.to_public_members(),
                "seq": lobby.next_seq,
            });
            lobby.broadcast_all(&roster);
        }
        return;
    }

    if typ == "queue_beatmap" {
        if member_id != lobby.leader_id {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Only the party leader can queue beatmaps"}),
            );
            return;
        }
        let set_id = data.get("setId").and_then(|x| x.as_i64()).unwrap_or(0);
        if set_id <= 0 {
            send_raw(
                out_tx,
                &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Invalid beatmap set id"}),
            );
            return;
        }
        let no_video = data.get("noVideo").and_then(|x| x.as_bool()).unwrap_or(false);
        let entry = QueueEntry {
            seq: lobby.next_seq,
            set_id,
            no_video,
            artist: data
                .get("artist")
                .and_then(|x| x.as_str())
                .map(String::from),
            title: data.get("title").and_then(|x| x.as_str()).map(String::from),
            creator: data
                .get("creator")
                .and_then(|x| x.as_str())
                .map(String::from),
            cover_url: data.get("coverUrl").cloned(),
            from_member_id: member_id.clone(),
        };
        lobby.next_seq += 1;
        lobby.queue.push(entry);
        while lobby.queue.len() > MAX_QUEUE {
            lobby.queue.remove(0);
        }
        let last = lobby.queue.last().unwrap();
        let msg = json!({
            "type": "beatmap_queued",
            "v": PROTOCOL_VERSION,
            "seq": last.seq,
            "fromMemberId": last.from_member_id,
            "setId": last.set_id,
            "noVideo": last.no_video,
            "artist": last.artist,
            "title": last.title,
            "creator": last.creator,
            "coverUrl": last.cover_url,
        });
        lobby.broadcast_all(&msg);
        return;
    }

    send_raw(
        out_tx,
        &json!({"type":"error","v":PROTOCOL_VERSION,"message":"Unknown message type"}),
    );
}

fn queue_to_json(e: &QueueEntry) -> Value {
    json!({
        "seq": e.seq,
        "setId": e.set_id,
        "noVideo": e.no_video,
        "artist": e.artist,
        "title": e.title,
        "creator": e.creator,
        "coverUrl": e.cover_url,
        "fromMemberId": e.from_member_id,
    })
}

async fn try_bind_port(port: u16) -> Option<TcpListener> {
    TcpListener::bind(("127.0.0.1", port)).await.ok()
}

pub async fn start_embedded_server() -> Result<u16, String> {
    {
        let g = EMBEDDED.lock().map_err(|e| e.to_string())?;
        if let Some(r) = g.as_ref() {
            return Ok(r.port);
        }
    }

    let mut listener = None;
    let mut chosen = 0u16;
    for p in 4680u16..=4699u16 {
        if let Some(l) = try_bind_port(p).await {
            chosen = l.local_addr().map_err(|e| e.to_string())?.port();
            listener = Some(l);
            break;
        }
    }
    if listener.is_none() {
        let l = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("Could not bind local party server: {e}"))?;
        chosen = l.local_addr().map_err(|e| e.to_string())?.port();
        listener = Some(l);
    }
    let listener = listener.unwrap();
    let (shutdown_tx, _) = tokio::sync::broadcast::channel::<()>(1);
    let shutdown_tx_loop = shutdown_tx.clone();
    let state = Arc::new(RwLock::new(ServerState::new()));

    tokio::spawn(async move {
        let mut shutdown_rx = shutdown_tx_loop.subscribe();
        loop {
            tokio::select! {
                biased;
                _ = shutdown_rx.recv() => break,
                acc = listener.accept() => {
                    let Ok((stream, addr)) = acc else { continue };
                    let Ok(ws) = tokio_tungstenite::accept_async(stream).await else { continue };
                    let state2 = state.clone();
                    let mut sr = shutdown_tx_loop.subscribe();
                    tokio::spawn(handle_connection(ws, addr, state2, sr));
                }
            }
        }
    });

    {
        let mut g = EMBEDDED.lock().map_err(|e| e.to_string())?;
        *g = Some(RunningServer {
            port: chosen,
            shutdown: shutdown_tx,
        });
    }

    Ok(chosen)
}

pub fn stop_embedded_server() -> Result<(), String> {
    let mut g = EMBEDDED.lock().map_err(|e| e.to_string())?;
    if let Some(r) = g.take() {
        let _ = r.shutdown.send(());
    }
    Ok(())
}

pub fn embedded_server_port() -> Option<u16> {
    EMBEDDED.lock().ok()?.as_ref().map(|r| r.port)
}
