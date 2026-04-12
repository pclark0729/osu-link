//! LAN discovery for party-server HTTP API via mDNS (`_osu-link-party._tcp`), with hosted fallback.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use if_addrs::IfAddr;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde_json::Value;

use crate::settings::{
    default_hosted_social_api_base, resolve_social_api_base_from_saved_settings, Settings,
};

const MDNS_SERVICE_TYPE: &str = "_osu-link-party._tcp.local.";
const DISCOVERY_TIMEOUT: Duration = Duration::from_millis(1800);
const CACHE_TTL: Duration = Duration::from_secs(90);

static CACHE: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn cache_get() -> Option<String> {
    let mut g = CACHE.lock().ok()?;
    let (base, at) = g.as_ref()?;
    if at.elapsed() < CACHE_TTL {
        return Some(base.clone());
    }
    *g = None;
    None
}

fn cache_set(base: String) {
    if let Ok(mut g) = CACHE.lock() {
        *g = Some((base, Instant::now()));
    }
}

fn local_ipv4_addresses() -> Vec<Ipv4Addr> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|iface| match iface.addr {
            IfAddr::V4(v4) if !v4.ip.is_loopback() => Some(v4.ip),
            _ => None,
        })
        .collect()
}

fn score_ip(ip: Ipv4Addr, locals: &[Ipv4Addr]) -> i32 {
    if ip.is_link_local() {
        return -100;
    }
    let mut best = -50;
    for l in locals {
        if same_subnet24(*l, ip) {
            best = best.max(100);
        } else if same_subnet16(*l, ip) {
            best = best.max(50);
        }
    }
    best
}

fn same_subnet24(a: Ipv4Addr, b: Ipv4Addr) -> bool {
    let ao = a.octets();
    let bo = b.octets();
    ao[0] == bo[0] && ao[1] == bo[1] && ao[2] == bo[2]
}

fn same_subnet16(a: Ipv4Addr, b: Ipv4Addr) -> bool {
    let ao = a.octets();
    let bo = b.octets();
    ao[0] == bo[0] && ao[1] == bo[1]
}

/// Verify `GET /health` identifies our party-server.
fn health_matches_party(body: &Value) -> bool {
    body.get("service")
        .and_then(|s| s.as_str())
        .is_some_and(|s| s == "osu-link-party-server")
        && body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false)
}

fn discover_party_http_base_blocking() -> Option<String> {
    let daemon = ServiceDaemon::new().ok()?;
    let receiver = daemon.browse(MDNS_SERVICE_TYPE).ok()?;
    let deadline = Instant::now() + DISCOVERY_TIMEOUT;
    let mut resolved: Vec<mdns_sd::ResolvedService> = Vec::new();

    while Instant::now() < deadline {
        let wait = Duration::from_millis(120).min(deadline.saturating_duration_since(Instant::now()));
        if wait.is_zero() {
            break;
        }
        match receiver.recv_timeout(wait) {
            Ok(ServiceEvent::ServiceResolved(svc)) => {
                if svc.is_valid() && svc.ty_domain.contains("osu-link-party") {
                    resolved.push(*svc);
                }
            }
            Ok(_) => {}
            Err(_) => {}
        }
    }
    let _ = daemon.shutdown();

    let locals = local_ipv4_addresses();
    let mut candidates: Vec<(Ipv4Addr, u16, i32)> = Vec::new();
    let mut seen: HashSet<(Ipv4Addr, u16)> = HashSet::new();

    for svc in resolved {
        let port = svc.get_port();
        for scoped in svc.get_addresses() {
            let ip = scoped.to_ip_addr();
            if let IpAddr::V4(v4) = ip {
                if v4.is_loopback() {
                    continue;
                }
                let key = (v4, port);
                if seen.insert(key) {
                    let sc = score_ip(v4, &locals);
                    candidates.push((v4, port, sc));
                }
            }
        }
    }

    candidates.sort_by(|a, b| b.2.cmp(&a.2));

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;

    for (ip, port, _) in candidates {
        let base = format!("http://{}:{}", ip, port);
        let url = format!("{}/health", base.trim_end_matches('/'));
        let Ok(resp) = client.get(url).send() else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(val) = resp.json::<Value>() else {
            continue;
        };
        if health_matches_party(&val) {
            return Some(base);
        }
    }
    None
}

/// Effective social API base: saved settings, else cached/discovered LAN party-server, else hosted default.
pub async fn resolve_social_api_base_effective(settings: &Settings) -> Option<String> {
    if let Some(base) = resolve_social_api_base_from_saved_settings(settings) {
        return Some(base);
    }
    if let Some(cached) = cache_get() {
        return Some(cached);
    }
    let discovered = tokio::task::spawn_blocking(discover_party_http_base_blocking)
        .await
        .ok()
        .flatten();
    if let Some(base) = discovered {
        cache_set(base.clone());
        return Some(base);
    }
    Some(default_hosted_social_api_base())
}

pub async fn resolve_discord_control_ws_url_effective(settings: &Settings) -> Option<String> {
    if let Some(ref u) = settings.discord_control_ws_url {
        let t = u.trim();
        if !t.is_empty() {
            return Some(t.trim_end_matches('/').to_string());
        }
    }
    let base = resolve_social_api_base_effective(settings).await?;
    crate::settings::http_base_to_control_ws_url(&base)
}
