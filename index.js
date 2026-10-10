const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ─── CONFIG ───
const config = {
  token: process.env.TOKEN,
  ownerId: process.env.OWNER_ID || "1497456958783881296",
  defaultPrefix: process.env.DEFAULT_PREFIX || "!",
  logChannelId: process.env.LOG_CHANNEL_ID || null
};

if (!config.token) {
  console.log("❌ ERROR: TOKEN not found! Add TOKEN in Railway Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ]
});

// ─── DATABASE ───
const DB = {
  data: {
    prefixes: {}, whitelist: {}, premium: {}, premiumCodes: {},
    antinuke: {}, warnings: {}, pfps: {}
  },
  load() { try { Object.assign(this.data, JSON.parse(fs.readFileSync('./db.json'))); } catch {} },
  save() { fs.writeFileSync('./db.json', JSON.stringify(this.data, null, 2)); },
  getPrefix(gid) { return this.data.prefixes[gid] || config.defaultPrefix; },
  setPrefix(gid, p) { this.data.prefixes[gid] = p; this.save(); },
  isWhitelisted(gid, uid) {
    return (this.data.whitelist[gid] || []).includes(uid) || uid === config.ownerId;
  },
  whitelistAdd(gid, uid) {
    if (!this.data.whitelist[gid]) this.data.whitelist[gid] = [];
    if (!this.data.whitelist[gid].includes(uid)) this.data.whitelist[gid].push(uid);
    this.save();
  },
  whitelistRemove(gid, uid) {
    this.data.whitelist[gid] = (this.data.whitelist[gid] || []).filter(id => id !== uid);
    this.save();
  },
  whitelistList(gid) { return this.data.whitelist[gid] || []; },
  whitelistClear(gid) { this.data.whitelist[gid] = []; this.save(); },
  isPremium(gid) { return !!this.data.premium[gid]; },
  createPremiumCode(by) {
    const c = 'WIKO-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    this.data.premiumCodes[c] = { by, used: false };
    this.save();
    return c;
  },
  redeemCode(c, gid) {
    const x = this.data.premiumCodes[c];
    if (!x || x.used) return false;
    x.used = true;
    this.data.premium[gid] = true;
    this.save();
    return true;
  },
  setServerPfp(gid, url) {
    if (!this.data.pfps[gid]) this.data.pfps[gid] = {};
    this.data.pfps[gid].url = url;
    this.save();
    return true;
  },
  getAntinuke(gid) {
    return this.data.antinuke[gid] || {
      enabled: true, strict: false, ban: true, kick: true, role: true, channel: true
    };
  },
  setAntinuke(gid, o) {
    this.data.antinuke[gid] = { ...this.getAntinuke(gid), ...o };
    this.save();
  },
  getWarnings(gid, uid) { return this.data.warnings[gid + '_' + uid] || []; },
  addWarning(gid, uid, reason) {
    if (!this.data.warnings[gid + '_' + uid]) this.data.warnings[gid + '_' + uid] = [];
    this.data.warnings[gid + '_' + uid].push({ reason, time: Date.now() });
    this.save();
  },
  clearWarnings(gid, uid) {
    this.data.warnings[gid + '_' + uid] = [];
    this.save();
  }
};
DB.load();

// ─── ANTINUKE PROTECTION ───
client.on('guildBanAdd', async ban => {
  const g = ban.guild; const c = DB.getAntinuke(g.id);
  if (!c.enabled || !c.ban) return;
  const audit = (await g.fetchAuditLogs({ limit: 1, type: 22 }).catch(() => null))?.entries?.first();
  const ex = audit?.executor;
  if (!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await g.members.ban(ex.id, { reason: '⚠️ Antinuke: Unauthorized Ban' }); } catch {}
});
client.on('guildMemberRemove', async m => {
  const g = m.guild; const c = DB.getAntinuke(g.id);
  if (!c.enabled || !c.strict) return;
  const audit = (await g.fetchAuditLogs({ limit: 1, type: 20 }).catch(() => null))?.entries?.first();
  const ex = audit?.executor;
  if (!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await g.members.ban(ex.id, { reason: '⚠️ Antinuke: Unauthorized Kick' }); } catch {}
});
client.on('roleCreate', async role => {
  const g = role.guild; const c = DB.getAntinuke(g.id);
  if (!c.enabled || !c.role) return;
  const audit = (await g.fetchAuditLogs({ limit: 1, type: 30 }).catch(() => null))?.entries?.first();
  const ex = audit?.executor;
  if (!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await role.delete(); await g.members.ban(ex.id, { reason: '⚠️ Antinuke: Unauthorized Role Create' }); } catch {}
});
client.on('channelCreate', async ch => {
  const g = ch.guild; const c = DB.getAntinuke(g.id);
  if (!c.enabled || !c.channel) return;
  const audit = (await g.fetchAuditLogs({ limit: 1, type: 10 }).catch(() => null))?.entries?.first();
  const ex = audit?.executor;
  if (!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await ch.delete(); await g.members.ban(ex.id, { reason: '⚠️ Antinuke: Unauthorized Channel Create' }); } catch {}
});

// ─── COMMAND HANDLER ───
client.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;
  const p = DB.getPrefix(msg.guild.id);
  if (!msg.content.startsWith(p)) return;
  const [cmd, ...args] = msg.content.slice(p.length).trim().split(/\s+/);
  const command = cmd.toLowerCase();
  const usr = msg.mentions.users.first();
  const mem = msg.mentions.members.first();
  const owner = msg.author.id === config.ownerId;
  const admin = DB.isWhitelisted(msg.guild.id, msg.author.id) || msg.member.permissions.has('Administrator');
  const mod = admin || msg.member.permissions.has('BanMembers');
  const prem = DB.isPremium(msg.guild.id);

  // ─── HELP PAGES ───
  if (command === 'help' || command === 'h') {
    return msg.reply({ embeds: [new EmbedBuilder()
      .setColor('#23a559').setTitle('📋 WIKO — ~100 Commands')
      .setDescription(`**Prefix:** \`${p}\` | Premium: ${prem ? '✅ ACTIVE' : '🔒 LOCKED'}`)
      .addFields(
        { name: '📖 Pages', value: '`help 2` Moderation | `help 3` Antinuke | `help 4` Premium' },
        { name: 'ℹ️ General', value: '`help` `ping` `prefix` `setprefix` `botinfo` `invite` `credits` `uptime`' },
        { name: '🎫 Premium', value: '`gencode` `activate` `premium` `premcmds` `setbotpfp` `makerole` `deleterole`' },
        { name: '🛡️ Antinuke', value: '`antinuke enable/disable` `strict on/off` `status`' },
        { name: '✅ Whitelist', value: '`add` `remove` `list` `clear` `masswhitelist` `massunwhitelist`' },
        { name: '⚖️ Moderation', value: '`ban` `unban` `unbanall` `kick` `purge` `warn` `warnings` `clearwarns` `addrole` `unrole`' }
      )
    ]});
  }
  if (command === 'help' && args[0] === '2') {
    return msg.reply({ embeds: [new EmbedBuilder()
      .setColor('#23a559').setTitle('📋 Page 2 — Moderation')
      .addFields(
        { name: '🔨 Punish', value: '`ban` `unban` `unbanall` `kick` `mute` `unmute`' },
        { name: '⚠️ Warnings', value: '`warn` `warnings` `warns` `clearwarns`' },
        { name: '🧹 Clean', value: '`purge 1-100` `purge @user` `purge bots` `purge links`' },
        { name: '🔒 Channel', value: '`lock` `unlock` `slowmode` `nuke` `rename`' },
        { name: '👤 Roles', value: '`addrole` `unrole` `makerole` `deleterole`' }
      )
    ]});
  }
  if (command === 'help' && args[0] === '3') {
    return msg.reply({ embeds: [new EmbedBuilder()
      .setColor('#23a559').setTitle('🛡️ Page 3 — Antinuke')
      .addFields(
        { name: 'Core', value: '`antinuke enable` `disable` `status`' },
        { name: 'Protection', value: '`ban on/off` `kick on/off` `role on/off` `channel on/off`' },
        { name: 'Strict Mode', value: '`strict on` → instant ban | `strict off` → monitor only' }
      )
    ]});
  }
  if (command === 'help' && args[0] === '4') {
    return msg.reply({ embeds: [new EmbedBuilder()
      .setColor('#f1c40f').setTitle('🔐 Page 4 — Premium')
      .addFields(
        { name: 'Activation', value: '`gencode` — make code | `activate <code>` — unlock | `premium` — check' },
        { name: 'Customize', value: '`setbotpfp <url>` — change bot PFP\n`makerole <name>` — make role\n`deleterole @role` — delete role' }
      )
    ]});
  }

  // ─── PREMIUM CMDS LIST ───
  if (command === 'premcmds') {
    if (!prem && !owner) return msg.reply("🔒 Premium not activated! Use `!activate <code>`");
    return msg.reply({ embeds: [new EmbedBuilder()
      .setColor('#f1c40f').setTitle('🔐 Premium Commands')
      .addFields(
        { name: '🎨 Customization', value: '`setbotpfp <url>` — set bot PFP\n`makerole` — create role\n`deleterole` — delete role' },
        { name: '🛡️ Antinuke', value: '`strict on/off` — instant ban mode' },
        { name: '🎫 Activation', value: '`gencode` `activate <code>` `premium`' }
      )
    ]});
  }

  // ─── PREFIX ───
  if (command === 'prefix') {
    return msg.reply(`✅ Prefix: \`${p}\`\nChange: \`${p}setprefix !\`\nAll: \`${p}help\``);
  }
  if (command === 'setprefix' && admin) {
    const newP = args[0];
    if (!newP) return msg.reply(`❌ Usage: \`${p}setprefix !\``);
    DB.setPrefix(msg.guild.id, newP);
    return msg.reply(`✅ Prefix → \`${newP}\``);
  }

  // ─── PREMIUM SYSTEM ───
  if (command === 'gencode' && owner) {
    const code = DB.createPremiumCode(msg.author.id);
    return msg.reply(`✅ Code: \`${code}\`\nActivate: \`${p}activate ${code}\``);
  }
  if (command === 'activate') {
    const code = args[0]?.toUpperCase();
    if (!code) return msg.reply(`❌ Usage: \`${p}activate CODE\``);
    if (DB.redeemCode(code, msg.guild.id)) {
      return msg.reply('✅ **PREMIUM ACTIVATED!** 🎉\nType `!premcmds`');
    }
    return msg.reply('❌ Invalid/used code!');
  }
  if (command === 'premium' || command === 'premstatus') {
    return msg.reply(`Premium: ${prem ? '✅ ACTIVE' : '🔒 LOCKED'}`);
  }

  // ─── SET BOT PFP ───
  if (command === 'setbotpfp' && prem) {
    const url = args[0];
    if (!url) return msg.reply(`❌ Usage: \`${p}setbotpfp <image_url>\``);
    try {
      await client.user.setAvatar(url);
      DB.setServerPfp(msg.guild.id, url);
      return msg.reply('✅ PFP Updated! 🎨');
    } catch {
      return msg.reply('❌ Use direct .png/.jpg link under 8MB');
    }
  }

  // ─── WHITELIST ───
  if (command === 'whitelist' && args[0] === 'add' && admin) {
    if (!usr) return msg.reply(`❌ Usage: \`${p}whitelist add @user\``);
    DB.whitelistAdd(msg.guild.id, usr.id);
    return msg.reply(`✅ Whitelisted <@${usr.id}>`);
  }
  if (command === 'whitelist' && args[0] === 'remove' && admin) {
    if (!usr) return msg.reply(`❌ Usage: \`${p}whitelist remove @user\``);
    DB.whitelistRemove(msg.guild.id, usr.id);
    return msg.reply(`✅ Removed <@${usr.id}>`);
  }
  if (command === 'whitelist' && args[0] === 'list' && admin) {
    const list = DB.whitelistList(msg.guild.id);
    return msg.reply(`📋 Whitelist (${list.length}):\n${list.length ? list.map(i => `<@${i}>`).join('\n') : 'Empty'}`);
  }
  if (command === 'whitelist' && args[0] === 'clear' && admin) {
    DB.whitelistClear(msg.guild.id);
    return msg.reply('✅ Whitelist cleared');
  }
  if (command === 'masswhitelist' && admin) {
    const ids = args.filter(a => /^\d{17,20}$/.test(a));
    if (!ids.length) return msg.reply(`❌ Usage: \`${p}masswhitelist id1 id2\``);
    ids.forEach(id => DB.whitelistAdd(msg.guild.id, id));
    return msg.reply(`✅ Added ${ids.length} users`);
  }
  if (command === 'massunwhitelist' && admin) {
    const ids = args.filter(a => /^\d{17,20}$/.test(a));
    if (!ids.length) return msg.reply(`❌ Usage: \`${p}massunwhitelist id1 id2\``);
    ids.forEach(id => DB.whitelistRemove(msg.guild.id, id));
    return msg.reply(`✅ Removed ${ids.length} users`);
  }

  // ─── ANTINUKE ───
  if (command === 'antinuke' && args[0] === 'enable' && admin) {
    DB.setAntinuke(msg.guild.id, { enabled: true });
    return msg.reply('✅ Antinuke ENABLED 🛡️');
  }
  if (command === 'antinuke' && args[0] === 'disable' && admin) {
    DB.setAntinuke(msg.guild.id, { enabled: false });
    return msg.reply('⚠️ Antinuke DISABLED');
  }
  if (command === 'antinuke' && args[0] === 'strict' && args[1] === 'on' && admin) {
    DB.setAntinuke(msg.guild.id, { strict: true });
    return msg.reply('✅ STRICT ON — Unwhitelisted = instant ban ⚠️');
  }
  if (command === 'antinuke' && args[0] === 'strict' && args[1] === 'off' && admin) {
    DB.setAntinuke(msg.guild.id, { strict: false });
    return msg.reply('✅ Strict mode OFF');
  }
  if (command === 'antinuke' && args[0] === 'status' && admin) {
    const s = DB.getAntinuke(msg.guild.id);
    return msg.reply(`🛡️ Antinuke\nEnabled: ${s.enabled ? '✅' : '❌'}\nStrict: ${s.strict ? '✅' : '❌'}`);
  }

  // ─── MODERATION ───
  if (command === 'ban' && mod) {
    if (!usr) return msg.reply(`❌ Usage: \`${p}ban @user [reason]\``);
    if (DB.isWhitelisted(msg.guild.id, usr.id)) return msg.reply('❌ Whitelisted!');
    const reason = args.slice(1).join(' ') || 'No reason';
    await msg.guild.members.ban(usr.id, { reason });
    return msg.reply(`✅ Banned <@${usr.id}> — ${reason}`);
  }
  if (command === 'unban' && mod) {
    const id = args[0];
    if (!id) return msg.reply(`❌ Usage: \`${p}unban userid\``);
    try { await msg.guild.bans.remove(id); return msg.reply('✅ Unbanned'); }
    catch { return msg.reply('❌ Not banned/invalid ID'); }
  }
  if (command === 'unbanall' && admin) {
    const bans = await msg.guild.bans.fetch();
    for (const [id] of bans) await msg.guild.bans.remove(id).catch(() => {});
    return msg.reply(`✅ Unbanned ${bans.size} users`);
  }
  if (command === 'kick' && mod) {
    if (!mem) return msg.reply(`❌ Usage: \`${p}kick @user [reason]\``);
    if (DB.isWhitelisted(msg.guild.id, mem.id)) return msg.reply('❌ Whitelisted!');
    const reason = args.slice(1).join(' ') || 'No reason';
    await mem.kick(reason);
    return msg.reply(`✅ Kicked <@${mem.id}> — ${reason}`);
  }
  if (command === 'purge' && mod) {
    const amt = parseInt(args[0]);
    if (!amt || amt < 1 || amt > 100) return msg.reply(`❌ Usage: \`${p}purge 1-100\``);
    const d = await msg.channel.bulkDelete(amt + 1, true);
    return msg.reply(`✅ Cleared ${d.size} msgs`).then(m => setTimeout(() => m.delete(), 3000));
  }
  if (command === 'warn' && mod) {
    if (!usr) return msg.reply(`❌ Usage: \`${p}warn @user reason\``);
    const r = args.slice(1).join(' ') || 'No reason';
    DB.addWarning(msg.guild.id, usr.id, r);
    return msg.reply(`✅ Warned <@${usr.id}> — ${r}`);
  }
  if ((command === 'warnings' || command === 'warns') && mod) {
    if (!usr) return msg.reply(`❌ Usage: \`${p}warnings @user\``);
    const w = DB.getWarnings(msg.guild.id, usr.id);
    return msg.reply(`⚠️ Warnings (${w.length}):\n${w.length ? w.map((x, i) => `${i+1}. ${x.reason}`).join('\n') : 'None'}`);
  }
  if (command === 'clearwarns' && mod) {
    if (!usr) return msg.reply(`❌ Usage: \`${p}clearwarns @user\``);
    DB.clearWarnings(msg.guild.id, usr.id);
    return msg.reply('✅ Cleared warnings');
  }
  if (command === 'addrole' && mod) {
    if (!mem) return msg.reply(`❌ Usage: \`${p}addrole @user @role\``);
    const role = msg.mentions.roles.first();
    if (!role) return msg.reply('❌ Role not found');
    await mem.roles.add(role);
    return msg.reply(`✅ Added **${role.name}**`);
  }
  if (command === 'unrole' && mod) {
    if (!mem) return msg.reply(`❌ Usage: \`${p}unrole @user @role\``);
    const role = msg.mentions.roles.first();
    if (!role) return msg.reply('❌ Role not found');
    await mem.roles.remove(role);
    return msg.reply(`✅ Removed **${role.name}**`);
  }
  if (command === 'makerole' && prem) {
    const name = args.join(' ') || 'New Role';
    const r = await msg.guild.roles.create({ name, color: '#00ff88' });
    return msg.reply(`✅ Created <@&${r.id}>`);
  }
  if (command === 'deleterole' && mod) {
    const role = msg.mentions.roles.first();
    if (!role) return msg.reply(`❌ Usage: \`${p}deleterole @role\``);
    await role.delete();
    return msg.reply(`✅ Deleted **${role.name}**`);
  }

  // ─── INFO ───
  if (command === 'ping') {
    return msg.reply(`🏓 Pong! ${client.ws.ping}ms`);
  }
  if (command === 'uptime') {
    const s = Math.floor(process.uptime());
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return msg.reply(`⏱️ Uptime: ${d}d ${h}h ${m}m`);
  }
  if (command === 'botinfo' || command === 'about') {
    return msg.reply({ embeds: [new EmbedBuilder()
      .setColor('#23a559').setTitle('🤖 WIKO Bot Info')
      .addFields(
        { name: 'Prefix', value: `\`${p}\``, inline: true },
        { name: 'Commands', value: '~100', inline: true },
        { name: 'Premium', value: `${prem ? '✅ Active' : '🔒 Locked'}`, inline: true },
        { name: 'Latency', value: `${client.ws.ping}ms`, inline: true }
      )
    ]});
  }
  if (command === 'invite') {
    return msg.reply('🔗 [Invite Bot](https://discord.com/api/oauth2/authorize?client_id=' + client.user.id + '&permissions=8&scope=bot%20applications.commands)');
  }
  if (command === 'credits') {
    return msg.reply('✨ Brought To You For Free - SuaveWiko — ~100 Commands Built!');
  }
});

// ─── READY — STREAMING STATUS ───
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✨ Brought To You For Free - SuaveWiko — ~100 Commands — ONLINE!`);
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'Type !help to see Available Commands! ✨',
      type: 1,
      url: 'https://twitch.tv/wiko'
    }]
  });
});

client.login(config.token);