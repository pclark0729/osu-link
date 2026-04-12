/**
 * Pi-hosted Discord bot: forwards slash commands to the local party-server internal API.
 */
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

const token = (process.env.DISCORD_BOT_TOKEN || "").trim();
const clientId = (process.env.DISCORD_CLIENT_ID || "").trim();
const internalSecret = (process.env.DISCORD_INTERNAL_SECRET || "").trim();
const relayBase = (process.env.RELAY_INTERNAL_URL || "http://127.0.0.1:4681").replace(/\/$/, "");

if (!token || !clientId || !internalSecret) {
  console.error(
    "Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_INTERNAL_SECRET (must match party-server).",
  );
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("osulink")
    .setDescription("Control osu-link on your linked desktop")
    .addSubcommand((s) =>
      s
        .setName("link")
        .setDescription("Link this Discord account using the code from osu-link Settings")
        .addStringOption((o) =>
          o.setName("code").setDescription("Pairing code from osu-link").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName("ping").setDescription("Check if your osu-link session is connected"),
    )
    .addSubcommand((s) =>
      s
        .setName("download")
        .setDescription("Download a beatmap set into osu! (same as app)")
        .addIntegerOption((o) =>
          o.setName("beatmapset_id").setDescription("Beatmap set ID").setRequired(true),
        )
        .addBooleanOption((o) =>
          o.setName("no_video").setDescription("Prefer pack without video").setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("search")
        .setDescription("Search beatmaps (results come from your osu-link app)")
        .addStringOption((o) => o.setName("query").setDescription("Search text").setRequired(true)),
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

async function registerCommands() {
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log("Slash commands registered.");
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} body
 */
async function internalPost(path, body) {
  const url = `${relayBase}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = data?.error || data?.message || res.statusText;
    throw new Error(typeof err === "string" ? err : JSON.stringify(data));
  }
  return data;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Ready as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "osulink") return;

  const sub = interaction.options.getSubcommand();
  const discordUserId = interaction.user.id;

  try {
    if (sub === "link") {
      const code = interaction.options.getString("code", true).trim().toUpperCase();
      await internalPost("/internal/discord/link", { code, discordUserId });
      await interaction.reply({
        content: "Linked! You can use `/osulink ping` to verify the desktop app is online.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "ping") {
      const data = await internalPost("/internal/discord/command", {
        discordUserId,
        command: "ping",
      });
      const r = data?.result;
      const ok = r?.ok !== false && (r?.type === "pong" || data?.ok);
      await interaction.reply({
        content: ok ? "osu-link responded: connected." : `Unexpected: ${JSON.stringify(data)}`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "download") {
      const beatmapsetId = interaction.options.getInteger("beatmapset_id", true);
      const noVideo = interaction.options.getBoolean("no_video") ?? false;
      await interaction.deferReply({ ephemeral: true });
      const data = await internalPost("/internal/discord/command", {
        discordUserId,
        command: "download",
        beatmapsetId,
        noVideo,
      });
      const dest = data?.result?.path || data?.result?.message || JSON.stringify(data?.result);
      await interaction.editReply({ content: `Download/import: ${dest}` });
      return;
    }

    if (sub === "search") {
      const query = interaction.options.getString("query", true);
      await interaction.deferReply({ ephemeral: true });
      const data = await internalPost("/internal/discord/command", {
        discordUserId,
        command: "search",
        query,
      });
      const summary = data?.result?.summary || JSON.stringify(data?.result);
      await interaction.editReply({ content: summary.slice(0, 1900) });
      return;
    }
  } catch (e) {
    const msg = /** @type {Error} */ (e).message || String(e);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: `Error: ${msg}` });
    } else {
      await interaction.reply({ content: `Error: ${msg}`, ephemeral: true });
    }
  }
});

await registerCommands();
await client.login(token);
