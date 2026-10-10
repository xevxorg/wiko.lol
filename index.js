const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');

// ─── CONFIG ───
const config = {
  token: process.env.TOKEN,
  ownerId: process.env.OWNER_ID || "1497456958783881296",
  defaultPrefix: process.env.DEFAULT_PREFIX || "k",
  botName: "Osaragi",
  totalCommands: 209,
  botPfpUrl: "https://cdn.discordapp.com/attachments/1557976174163009606/1558294137021927535/f7162e50839e53367572f3a9c86e0601.jpg?ex=6acaea01&is=6ac99881&hm=e43b6d161eb1aa77bef0ad8f2c7d2e18741ebc42b0f490f53415a14be34e9a7f&"
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
    const c = 'OSARAGI-' + Math.random().toString(36).slice(2,10).toUpperCase();
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

// ─── HELP EMBED + DROPDOWN ───
function buildHomeEmbed(p, prem) {
  return new EmbedBuilder()
    .setColor('#b886fc')
    .setAuthor({ name: config.botName })
    .setThumbnail(config.botPfpUrl)
    .addFields(
      { name: 'Prefix', value: `\`${p}\``, inline: true },
      { name: 'Total Commands', value: `${config.totalCommands}`, inline: true },
      { name: 'Status', value: prem ? '✅ Premium' : '🔒 Free', inline: true }
    )
    .setTitle(`Welcome to ${config.botName}!`)
    .setDescription('Your all-in-one server protection and all in one bot.\n\nSelect a category from the dropdown menu below to explore my commands.')
    .setFooter({ text: `Use ${p}help <command> for details about a specific command` });
}

function buildSelectMenu() {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('help_menu')
    .setPlaceholder('Select a category...')
    .addOptions([
      { label: '1. Antinuke', value: 'antinuke', description: 'Protect your server from nukers and mass actions' },
      { label: '2. Moderation', value: 'moderation', description: 'Kick, ban, mute, warn and manage members' },
      { label: '3. Logging', value: 'logging', description: 'Log server events to dedicated channels' },
      { label: '4. Automod', value: 'automod', description: 'Auto-moderate spam, links, bad words and more' },
      { label: '5. Greet & Farewell', value: 'greet', description: 'Welcome and farewell messages with custom styles' },
      { label: '6. Giveaway', value: 'giveaway', description: 'Host, end, reroll and manage giveaways' },
      { label: '7. Premium', value: 'premium', description: 'Unlock premium features' },
      { label: '8. Fun', value: 'fun', description: 'Games, roasts, trivia and entertainment' },
      { label: '9. Info', value: 'info', description: 'Bot statistics, uptime and general info' },
      { label: '10. Util', value: 'util', description: 'Everyday utility tools and helper commands' }
    ])
  );
}

function buildCategoryEmbed(category, p) {
  const embeds = {
    antinuke: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('🛡️ Antinuke')
      .setDescription('Protect your server from nukers, rogue bots and mass actions')
      .addFields(
        { name: 'Core', value: `\`${p}antinuke enable/disable/status\`\n\`${p}strict on/off\`` },
        { name: 'Whitelist', value: `\`${p}whitelist add/remove/list/clear\`\n\`${p}masswhitelist/massunwhitelist\`` },
        { name: 'Protection', value: 'Auto-ban unwhitelisted users who:\n• Ban members\n• Kick members\n• Create roles\n• Create channels' }
      ),
    moderation: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('⚖️ Moderation')
      .setDescription('Kick, ban, mute, warn and manage your members')
      .addFields(
        { name: 'Punish', value: `\`${p}ban @user [reason]\`\n\`${p}unban ID\`\n\`${p}unbanall\`\n\`${p}kick @user [reason]\`` },
        { name: 'Warnings', value: `\`${p}warn @user reason\`\n\`${p}warnings @user\`\n\`${p}clearwarns @user\`` },
        { name: 'Roles', value: `\`${p}addrole @user @role\`\n\`${p}unrole @user @role\`\n\`${p}makerole [name]\`\n\`${p}deleterole @role\`` },
        { name: 'Clean', value: `\`${p}purge 1-100\`` }
      ),
    logging: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('📝 Logging')
      .setDescription('Log server events to dedicated channels')
      .addFields(
        { name: 'Setup', value: `\`${p}logchannel set #channel\`\n\`${p}logchannel off\`` },
        { name: 'Events', value: 'Member joins/leaves, bans, kicks, message deletes/edits, role changes, channel/role updates' }
      ),
    automod: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('🤖 Automod')
      .setDescription('Auto-moderate spam, links, bad words and more')
      .addFields(
        { name: 'Filters', value: `\`${p}automod link on/off\`\n\`${p}automod spam on/off\`\n\`${p}automod badword add/remove\`` },
        { name: 'Actions', value: 'Auto-delete, warn, or kick rule-breakers' }
      ),
    greet: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('👋 Greet & Farewell')
      .setDescription('Welcome and farewell messages with custom styles')
      .addFields(
        { name: 'Welcome', value: `\`${p}welcome set #channel\`\n\`${p}welcome msg <text>\`\n\`${p}welcome preview\`` },
        { name: 'Farewell', value: `\`${p}farewell set #channel\`\n\`${p}farewell msg <text>\`` }
      ),
    giveaway: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('🎁 Giveaway')
      .setDescription('Host, end, reroll and manage giveaways')
      .addFields(
        { name: 'Commands', value: `\`${p}g start #channel duration winners prize\`\n\`${p}g end [messageID]\`\n\`${p}g reroll [messageID]\`\n\`${p}g delete [messageID]\`` }
      ),
    premium: new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('🔐 Premium')
      .setDescription('Unlock premium features with a server subscription')
      .addFields(
        { name: 'Activation', value: `\`${p}gencode\` — create code (owner only)\n\`${p}activate <code>\` — unlock premium\n\`${p}premium\` — check status` },
        { name: 'Exclusive', value: `\`${p}setbotpfp <url>\` — server-only bot avatar\n\`${p}strict on\` — instant ban mode\nCustom role colors, advanced logging, priority support` }
      ),
    fun: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('🎉 Fun')
      .setDescription('Games, roasts, trivia and other entertainment')
      .addFields(
        { name: 'Available', value: `\`${p}8ball <question>\`\n\`${p}coinflip\`\n\`${p}dice\`\n\`${p}roast @user\`\n\`${p}rps\`\n\`${p}trivia\`` }
      ),
    info: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('ℹ️ Info')
      .setDescription('Bot statistics, uptime and general information')
      .addFields(
        { name: 'Stats', value: `\`${p}ping\` — latency\n\`${p}uptime\` — running time\n\`${p}botinfo\` — full info\n\`${p}invite\` — bot invite link\n\`${p}credits\` — credits` }
      ),
    util: new EmbedBuilder()
      .setColor('#b886fc')
      .setTitle('🔧 Util')
      .setDescription('Everyday utility, tools and helper commands')
      .addFields(
        { name: 'General', value: `\`${p}prefix\` — show current prefix\n\`${p}setprefix <new>\` — change prefix\n\`${p}help\` — show this menu\n\`${p}help <command>\` — command details` },
        { name: 'Server', value: `\`${p}serverinfo\` — server stats\n\`${p}membercount\` — member count\n\`${p}roleinfo @role\` — role details` }
      )
  };
  return embeds[category]?.setFooter({ text: `Prefix: ${p}` }) || embeds.antinuke;
}

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

  // ─── HELP MENU ───
  if (command === 'help' || command === 'h') {
    if (args[0]) {
      return msg.reply(`ℹ️ Use: \`${p}help\` — open menu\nSelect from dropdown to browse categories`);
    }
    return msg.reply({
      embeds: [buildHomeEmbed(p, prem)],
      components: [buildSelectMenu()]
    });
  }

  // ─── PREFIX ───
  if (command === 'prefix') {
    return msg.reply(`✅ Prefix: \`${p}\`\nChange: \`${p}setprefix k\``);
  }
  if (command === 'setprefix' && admin) {
    const newP = args[0];
    if (!newP) return msg.reply(`❌ Usage: \`${p}setprefix k\``);
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
      return msg.reply('✅ **PREMIUM ACTIVATED!** 🎉\nType `khelp` to see all features');
    }
    return msg.reply('❌ Invalid/used code!');
  }
  if (command === 'premium' || command === 'premstatus') {
    return msg.reply(`Premium: ${prem ? '✅ ACTIVE' : '🔒 LOCKED'}`);
  }
  if (command === 'premcmds') {
    if (!prem && !owner) return msg.reply("🔒 Premium not activated! Use `kactivate <code>`");
    return msg.reply({ embeds: [buildCategoryEmbed('premium', p)] });
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
    const r = await msg.guild.roles.create({ name, color: '#b886fc' });
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
      .setColor('#b886fc')
      .setTitle(`🤖 ${config.botName} Info`)
      .setThumbnail(config.botPfpUrl)
      .addFields(
        { name: 'Prefix', value: `\`${p}\``, inline: true },
        { name: 'Commands', value: `${config.totalCommands}`, inline: true },
        { name: 'Premium', value: `${prem ? '✅ Active' : '🔒 Locked'}`, inline: true },
        { name: 'Latency', value: `${client.ws.ping}ms`, inline: true },
        { name: 'Owner', value: `<@${config.ownerId}>`, inline: true }
      )
    ]});
  }
  if (command === 'invite') {
    return msg.reply('🔗 [Invite Bot](https://discord.com/api/oauth2/authorize?client_id=' + client.user.id + '&permissions=8&scope=bot%20applications.commands)');
  }
  if (command === 'credits') {
    return msg.reply(`✨ ${config.botName} — All-in-One Antinuke & Utility Bot\nBuilt with ❤️`);
  }
});

// ─── DROPDOWN INTERACTION HANDLER ───
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== 'help_menu') return;
  const p = DB.getPrefix(interaction.guild.id);
  const category = interaction.values[0];
  await interaction.update({
    embeds: [buildCategoryEmbed(category, p)],
    components: [buildSelectMenu()]
  });
});

// ─── READY — STREAMING STATUS + SET PFP ───
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✨ ${config.botName} — ${config.totalCommands} Commands — ONLINE!`);
  
  // Set bot avatar
  try {
    await client.user.setAvatar(config.botPfpUrl);
    console.log('✅ Bot PFP set!');
  } catch (e) {
    console.log('⚠️ Could not set PFP:', e.message);
  }
  
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: '@Osaragi Type !help To Show Available Commands',
      type: 1,
      url: 'https://twitch.tv/osaragi'
    }]
  });
});

client.login(config.token);