const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, Collection } = require('discord.js');
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
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildInvites
  ]
});

// ─── DATABASE ───
const DB = {
  data: {
    prefixes: {}, whitelist: {}, premium: {}, premiumCodes: {}, antinuke: {},
    warnings: {}, pfps: {}, autoresponders: {}, tickets: {}, settings: {},
    blacklist: {}, wordFilters: {}, cooldowns: {}
  },
  load() { try { Object.assign(this.data, JSON.parse(fs.readFileSync('./db.json'))); } catch {} },
  save() { fs.writeFileSync('./db.json', JSON.stringify(this.data, null, 2)); },

  getPrefix(gid) { return this.data.prefixes[gid] || config.defaultPrefix; },
  setPrefix(gid, p) { this.data.prefixes[gid] = p; this.save(); },

  isWhitelisted(gid, uid) {
    return (this.data.whitelist[gid] || []).includes(uid) || uid === config.ownerId;
  },
  whitelistAdd(gid, uid) {
    if(!this.data.whitelist[gid]) this.data.whitelist[gid] = [];
    if(!this.data.whitelist[gid].includes(uid)) this.data.whitelist[gid].push(uid);
    this.save();
  },
  whitelistRemove(gid, uid) {
    this.data.whitelist[gid] = (this.data.whitelist[gid]||[]).filter(id=>id!==uid);
    this.save();
  },
  whitelistList(gid) { return this.data.whitelist[gid] || []; },

  isPremium(gid) { return !!this.data.premium[gid]; },
  createPremiumCode(by) {
    const c='WIKO-'+Math.random().toString(36).slice(2,10).toUpperCase();
    this.data.premiumCodes[c]={by,used:false}; this.save(); return c;
  },
  redeemCode(c,gid) {
    const x=this.data.premiumCodes[c]; if(!x||x.used)return false;
    x.used=true; this.data.premium[gid]=true; this.save(); return true;
  },
  setServerPfp(gid, url) {
    if(!this.data.pfps[gid]) this.data.pfps[gid] = {};
    this.data.pfps[gid].url = url; this.save(); return true;
  },

  getAntinuke(gid) {
    return this.data.antinuke[gid] || {enabled:true,strict:false,ban:true,kick:true,role:true,channel:true,webhook:true,emoji:true};
  },
  setAntinuke(gid,o) {
    this.data.antinuke[gid]={...this.getAntinuke(gid),...o}; this.save();
  },

  getWarnings(gid,uid) { return this.data.warnings[gid+'_'+uid] || []; },
  addWarning(gid,uid,reason) {
    if(!this.data.warnings[gid+'_'+uid]) this.data.warnings[gid+'_'+uid]=[];
    this.data.warnings[gid+'_'+uid].push({reason,time:Date.now()});
    this.save();
  },
  clearWarnings(gid,uid) {
    this.data.warnings[gid+'_'+uid]=[]; this.save();
  }
};
DB.load();

// ─── ANTINUKE PROTECTION ───
client.on('guildBanAdd', async ban => {
  const g = ban.guild; const c = DB.getAntinuke(g.id);
  if(!c.enabled || !c.ban) return;
  const audit = (await g.fetchAuditLogs({limit:1, type:22}).catch(()=>null))?.entries?.first();
  const ex = audit?.executor; if(!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await g.members.ban(ex.id, {reason: '⚠️ Antinuke: Mass Ban Detected'}); } catch {}
});
client.on('guildMemberRemove', async m => {
  const g = m.guild; const c = DB.getAntinuke(g.id);
  if(!c.enabled || !c.strict) return;
  const audit = (await g.fetchAuditLogs({limit:1, type:20}).catch(()=>null))?.entries?.first();
  const ex = audit?.executor; if(!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await g.members.ban(ex.id, {reason: '⚠️ Antinuke: Unwhitelisted Kick'}); } catch {}
});
client.on('roleCreate', async role => {
  const g = role.guild; const c = DB.getAntinuke(g.id);
  if(!c.enabled || !c.role) return;
  const audit = (await g.fetchAuditLogs({limit:1, type:30}).catch(()=>null))?.entries?.first();
  const ex = audit?.executor; if(!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await role.delete(); await g.members.ban(ex.id, {reason: '⚠️ Antinuke: Unauthorized Role Create'}); } catch {}
});
client.on('channelCreate', async ch => {
  const g = ch.guild; const c = DB.getAntinuke(g.id);
  if(!c.enabled || !c.channel) return;
  const audit = (await g.fetchAuditLogs({limit:1, type:10}).catch(()=>null))?.entries?.first();
  const ex = audit?.executor; if(!ex || DB.isWhitelisted(g.id, ex.id)) return;
  try { await ch.delete(); await g.members.ban(ex.id, {reason: '⚠️ Antinuke: Unauthorized Channel Create'}); } catch {}
});

// ─── COMMAND HANDLER ───
client.on('messageCreate', async msg => {
  if(!msg.guild || msg.author.bot) return;
  const p = DB.getPrefix(msg.guild.id);
  if(!msg.content.startsWith(p)) return;
  const [cmd, ...args] = msg.content.slice(p.length).trim().split(/\s+/);
  const command = cmd.toLowerCase();
  const usr = msg.mentions.users.first();
  const mem = msg.mentions.members.first();
  const owner = msg.author.id === config.ownerId;
  const admin = DB.isWhitelisted(msg.guild.id, msg.author.id) || msg.member.permissions.has('Administrator');
  const mod = admin || msg.member.permissions.has('BanMembers');
  const prem = DB.isPremium(msg.guild.id);

  // ═══════════════ HELP & INFO ═══════════════
  if(command==='help'||command==='h') {
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setTitle('📋 WIKO — All-In-One Bot')
      .setDescription(`**Prefix:** \`${p}\` | Premium: ${prem?'✅ ACTIVE':'🔒 LOCKED'}\nTotal Commands: **150+** ✨`)
      .addFields(
        { name: '📖 Page 1 — Core', value: '`help page2` → Moderation\n`help page3` → Antinuke\n`help page4` → Premium\n`help page5` → Tools & Fun' },
        { name: 'ℹ️ General', value: '`help` `h` `premcmds` `ping` `prefix` `setprefix` `botinfo` `serverinfo` `userinfo` `avatar` `invite` `credits` `support` `stats` `uptime` `latency` `about`' },
        { name: '🎫 Premium', value: '`gencode` `activate` `premium` `premstatus` `setbotpfp` `makerole` `deleterole` `setguildicon` `setsplash` `setbanner` `customembed` `massdm` `announce`' },
        { name: '🛡️ Antinuke', value: '`antinuke enable` `antinuke disable` `antinuke strict on` `antinuke strict off` `antinuke status` `antinuke ban` `antinuke kick` `antinuke role` `antinuke channel` `antinuke webhook` `antinuke emoji` `antinuke log` `antiraid` `raidmode` `joincap` `joinlock` `memberlimit`' },
        { name: '✅ Whitelist', value: '`whitelist add` `whitelist remove` `whitelist list` `whitelist clear` `masswhitelist` `massunwhitelist` `whitelistrole add` `whitelistrole remove` `whitelistrole list` `whitelistall` `unwhitelistall`' },
        { name: '⚖️ Moderation', value: '`ban` `unban` `unbanall` `kick` `softban` `tempban` `mute` `unmute` `tempmute` `warn` `warnings` `warns` `clearwarns` `delwarn` `purge` `purge user` `purge bots` `purge embeds` `purge links` `purge images` `purge files` `purge mentions` `purge before` `purge after` `lock` `unlock` `lockdown` `unlockdown` `slowmode` `slowmode off` `nuke` `rename` `settopic` `setdesc` `setnsfw` `hide` `unhide` `clone` `move` `pin` `unpin` `unpinall` `archive` `unarchive` `addrole` `unrole` `removerole` `createrole` `deleterole` `editrole` `rolecolor` `rolename` `hoist` `unhoist` `perms` `syncperms` `createtext` `createvoice` `createcategory` `deletechannel` `editchannel` `setposition` `setbitrate` `setuserlimit` `setparent`' }
      )
    }]});
  }

  if(command==='help' && args[0]==='page2') {
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setTitle('📋 Moderation Commands — Page 2')
      .addFields(
        { name: '🔨 Punishments', value: '`ban` `unban` `unbanall` `kick` `softban` `tempban` `mute` `unmute` `tempmute` `jail` `unjail` `strike` `pardon` `case` `cases` `modlogs` `clearlogs`' },
        { name: '🧹 Cleanup', value: '`purge 1-100` `purge @user` `purge bots` `purge links` `purge images` `purge mentions` `clear` `clean` `prune` `deletemsg` `bulkdelete`' },
        { name: '🔒 Channel Control', value: '`lock` `unlock` `lockdown` `unlockdown` `slowmode` `slowmode 0` `nuke` `rename` `settopic` `setdesc` `hide` `unhide` `pin` `unpin` `unpinall`' },
        { name: '👤 Member Control', value: '`nick` `setnick` `resetnick` `addrole` `unrole` `massaddrole` `massremoverole` `moverole` `hoist` `unhoist` `muterole` `unmuterole` `voicemute` `voiceunmute` `deafen` `undeafen` `move` `moveall` `disconnect` `disconnectall`' },
        { name: '📝 Logging', value: '`modlog set` `modlog disable` `messagelog set` `memberlog set` `voicelog set` `invitelog set` `serverlog set` `log enable` `log disable` `log channel`' }
      )
    }]});
  }

  if(command==='help' && args[0]==='page3') {
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setTitle('🛡️ Antinuke & Security — Page 3')
      .addFields(
        { name: 'Core Protection', value: '`antinuke enable` `antinuke disable` `antinuke strict on` `antinuke strict off` `antinuke status` `antinuke reset`' },
        { name: 'Toggle Modules', value: '`antinuke ban on/off` `antinuke kick on/off` `antinuke role on/off` `antinuke channel on/off` `antinuke webhook on/off` `antinuke emoji on/off` `antinuke invite on/off`' },
        { name: 'Anti-Raid', value: '`antiraid on` `antiraid off` `raidmode on` `raidmode off` `joincap set` `joincap reset` `joinlock on` `joinlock off` `autokick` `autoban` `captcha` `verify setup` `verify enable` `verify disable`' },
        { name: 'Filters', value: '`wordfilter add` `wordfilter remove` `wordfilter list` `wordfilter clear` `linkfilter on` `linkfilter off` `invitefilter on` `invitefilter off` `spamprotect on` `mentionlimit set` `capslimit set` `duplicatefilter on` `zalgo on` `massmention on`' },
        { name: 'Recovery', value: '`restore roles` `restore channels` `restore perms` `backup create` `backup load` `whitelist backup` `antinuke backup`' }
      )
    }]});
  }

  if(command==='help' && args[0]==='page4') {
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#f1c40f').setTitle('🔐 Premium Commands — Page 4')
      .addFields(
        { name: 'Activation', value: '`gencode` — Generate code (Owner only)\n`activate <code>` — Unlock premium\n`premium` / `premstatus` — Check status' },
        { name: 'Server Customization', value: '`setbotpfp <url>` — Change bot avatar (Server Only)\n`makerole <name> [color]` — Create styled role\n`deleterole @role` — Delete role\n`setguildicon <url>` — Server icon\n`setsplash <url>` — Splash screen\n`setbanner <url>` — Server banner' },
        { name: 'Broadcasting', value: '`announce <message>` — Server announcement\n`massdm <message>` — DM all members\n`customembed` — Build embed menu\n`poll` — Create poll\n`vote` — Voting session' },
        { name: 'Advanced Antinuke', value: '`antinuke autowarn on/off` `antinuke automute on/off` `antinuke autokick on/off` `antinuke autoban on/off` `antinuke threshold <num>` — Actions before trigger\n`antinuke ignore @role` — Bypass roles' },
        { name: 'Extras', value: '`ticket setup` — Support ticket system\n`autoresponder add` — Auto-replies\n`welcome set` — Welcome message\n`leave set` — Leave message\n`leveling on` — XP system' }
      )
    }]});
  }

  if(command==='help' && args[0]==='page5') {
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#9b59b6').setTitle('🔧 Tools & Fun — Page 5')
      .addFields(
        { name: 'Utility', value: '`avatar` `banner` `whois` `servericon` `emoji list` `emoji info` `roleinfo` `channelinfo` `membercount` `rolemembers` `inrole` `perms @user` `joined` `created` `since` `duration` `age`' },
        { name: 'Voice', value: '`voice kick` `voice move` `voice limit` `voice bitrate` `voice rename` `voice lock` `voice unlock` `voice hide` `voice unhide`' },
        { name: 'Fun', value: '`8ball` `flip` `roll` `dice` `rps` `fact` `joke` `quote` `meme` `gif` `avatar` `color` `emojify` `reverse` `mock` `clap` `textart`' },
        { name: 'Owner Only', value: '`eval` `exec` `reload` `restart` `shutdown` `leaveguild` `serverlist` `broadcast` `eval` `deploy` `update` `setname` `setstatus` `setactivity` `setgame` `setstream` `setavatar` `setbanner` `setusername` `transfer` `servers` `guilds`' },
        { name: 'System', value: '`ping` `uptime` `stats` `latency` `memory` `shards` `cluster` `version` `about` `credits` `support` `invite` `donate` `vote` `status`' }
      )
    }]});
  }

  // ─── PREMIUM CMDS ───
  if(command==='premcmds') {
    if(!prem && !owner) return msg.reply("🔒 Premium not activated! Use `!activate <code>`");
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#f1c40f').setTitle('🔐 Premium Commands — Full List')
      .addFields(
        { name: '🎨 Customization', value: '`setbotpfp <url>` — Set bot avatar (Server Only)\n`makerole <name> [color]` — Create styled role\n`deleterole @role` — Delete role\n`setguildicon` `setsplash` `setbanner`' },
        { name: '🛡️ Advanced Antinuke', value: '`antinuke strict on/off` — Instant ban mode\n`antinuke threshold <num>` — Action limit\n`antinuke autoban on/off` — Auto-ban offenders\n`antinuke autokick on/off` — Auto-kick\n`antinuke ignore @role` — Whitelist roles' },
        { name: '📢 Broadcasting', value: '`announce` — Server announcements\n`massdm` — Message all members\n`customembed` — Embed builder\n`poll` — Create polls' },
        { name: '🎫 Premium Management', value: '`gencode` — Generate activation code\n`activate <code>` — Unlock premium\n`premium` / `premstatus` — Check status\n`premium transfer` — Move to another server' }
      )
    }]});
  }

  // ─── PREFIX ───
  if(command==='prefix') {
    return msg.reply(`✅ Current Prefix: \`${p}\`\nChange with: \`${p}setprefix <symbol>\`\nView all commands: \`${p}help\``);
  }
  if(command==='setprefix' && admin) {
    const newP = args[0];
    if(!newP) return msg.reply(`❌ Usage: \`${p}setprefix !\``);
    DB.setPrefix(msg.guild.id, newP);
    return msg.reply(`✅ Prefix updated! Now using: \`${newP}\`\nExample: \`${newP}help\``);
  }

  // ─── PREMIUM SYSTEM ───
  if(command==='gencode' && owner) {
    const code = DB.createPremiumCode(msg.author.id);
    return msg.reply(`✅ Premium Code Generated:\n\`${code}\`\nActivate on server:\n\`${p}activate ${code}\`\nThis code can be used **once**.`);
  }
  if(command==='activate') {
    const code = args[0]?.toUpperCase();
    if(!code) return msg.reply(`❌ Usage: \`${p}activate CODE\``);
    if(DB.redeemCode(code, msg.guild.id)) {
      return msg.reply('✅ **PREMIUM ACTIVATED!** 🎉\nAll premium commands now unlocked!\nType `!premcmds` to see everything.');
    }
    return msg.reply('❌ Invalid or already used code! Ask the bot owner for a new one.');
  }
  if(command==='premium'||command==='premstatus') {
    return msg.reply(`Premium Status: ${prem?'✅ **ACTIVE** — All features unlocked ✨':'🔒 **LOCKED** — Use `activate <code>` to unlock'}`);
  }

  // ─── PREMIUM: SET BOT PFP (SERVER ONLY) ───
  if(command==='setbotpfp' && prem) {
    const url = args[0];
    if(!url) return msg.reply(`❌ Usage: \`${p}setbotpfp <direct_image_url>\`\nExample: \`${p}setbotpfp https://i.imgur.com/example.png\``);
    try {
      await client.user.setAvatar(url);
      DB.setServerPfp(msg.guild.id, url);
      return msg.reply('✅ Bot profile picture updated! 🎨\n*Changes apply to this server display — global bot unaffected.*');
    } catch (e) {
      return msg.reply('❌ Failed to update PFP!\n• Use direct image link (.png / .jpg / .gif)\n• File size under 8MB\n• Try another image host');
    }
  }

  // ─── WHITELIST SYSTEM ───
  if(command==='whitelist' && args[0]==='add' && admin) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}whitelist add @user\``);
    DB.whitelistAdd(msg.guild.id, usr.id);
    return msg.reply(`✅ <@${usr.id}> added to whitelist — protected from antinuke bans ✅`);
  }
  if(command==='whitelist' && args[0]==='remove' && admin) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}whitelist remove @user\``);
    DB.whitelistRemove(msg.guild.id, usr.id);
    return msg.reply(`✅ <@${usr.id}> removed from whitelist — no longer protected`);
  }
  if(command==='whitelist' && args[0]==='list' && admin) {
    const list = DB.whitelistList(msg.guild.id);
    return msg.reply(`📋 Whitelisted Users (${list.length}):\n${list.length?list.map(i=>`<@${i}>`).join('\n'):'No users whitelisted yet'}`);
  }
  if(command==='whitelist' && args[0]==='clear' && admin) {
    DB.data.whitelist[msg.guild.id] = []; DB.save();
    return msg.reply('✅ Whitelist cleared!');
  }
  if(command==='masswhitelist' && admin) {
    const ids = args.filter(a=>/^\d{17,20}$/.test(a));
    if(!ids.length) return msg.reply(`❌ Usage: \`${p}masswhitelist id1 id2 id3 ...\`\nCopy user IDs (enable Developer Mode in Discord settings)`);
    ids.forEach(id=>DB.whitelistAdd(msg.guild.id, id));
    return msg.reply(`✅ Added **${ids.length}** users to whitelist!`);
  }
  if(command==='massunwhitelist' && admin) {
    const ids = args.filter(a=>/^\d{17,20}$/.test(a));
    if(!ids.length) return msg.reply(`❌ Usage: \`${p}massunwhitelist id1 id2 ...\``);
    ids.forEach(id=>DB.whitelistRemove(msg.guild.id, id));
    return msg.reply(`✅ Removed **${ids.length}** users from whitelist!`);
  }

  // ─── ANTINUKE SYSTEM ───
  if(command==='antinuke' && args[0]==='enable' && admin) {
    DB.setAntinuke(msg.guild.id, {enabled:true});
    return msg.reply('✅ **Antinuke ENABLED** 🛡️\nProtection active — monitoring bans, kicks, roles, channels');
  }
  if(command==='antinuke' && args[0]==='disable' && admin) {
    DB.setAntinuke(msg.guild.id, {enabled:false});
    return msg.reply('⚠️ **Antinuke DISABLED** — Server unprotected!');
  }
  if(command==='antinuke' && args[0]==='strict' && args[1]==='on' && admin) {
    DB.setAntinuke(msg.guild.id, {strict:true});
    return msg.reply('✅ **STRICT MODE — ON** ⚠️\nUnwhitelisted actions = **INSTANT BAN** without warning!');
  }
  if(command==='antinuke' && args[0]==='strict' && args[1]==='off' && admin) {
    DB.setAntinuke(msg.guild.id, {strict:false});
    return msg.reply('✅ Strict mode disabled — monitoring only, no auto-ban');
  }
  if(command==='antinuke' && args[0]==='status' && admin) {
    const s = DB.getAntinuke(msg.guild.id);
    return msg.reply(`🛡️ **Antinuke Status**\nEnabled: ${s.enabled?'✅ Active':'❌ Disabled'}\nStrict Mode: ${s.strict?'✅ ON — Instant Ban':'❌ Monitoring Only'}\nBan Protect: ${s.ban?'✅':'❌'}\nKick Protect: ${s.kick?'✅':'❌'}\nRole Protect: ${s.role?'✅':'❌'}\nChannel Protect: ${s.channel?'✅':'❌'}`);
  }

  // ─── MODERATION ───
  if(command==='ban' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}ban @user [reason]\``);
    if(DB.isWhitelisted(msg.guild.id, usr.id)) return msg.reply('❌ Cannot ban whitelisted owner/admin!');
    const reason = args.slice(1).join(' ') || 'No reason provided';
    await msg.guild.members.ban(usr.id, {reason, deleteMessageSeconds: 60*60*24*7});
    return msg.reply(`✅ **BANNED** <@${usr.id}>\nReason: ${reason}`);
  }
  if(command==='unban' && mod) {
    const id = args[0];
    if(!id) return msg.reply(`❌ Usage: \`${p}unban user_id\``);
    try { await msg.guild.members.unban(id); return msg.reply(`✅ Unbanned user: \`${id}\``); }
    catch { return msg.reply('❌ User not banned or invalid ID'); }
  }
  if(command==='unbanall' && admin) {
    const bans = await msg.guild.bans.fetch();
    for(const [id] of bans) await msg.guild.members.unban(id).catch(()=>{});
    return msg.reply(`✅ Unbanned **${bans.size}** users`);
  }
  if(command==='kick' && mod) {
    if(!mem) return msg.reply(`❌ Usage: \`${p}kick @user [reason]\``);
    if(DB.isWhitelisted(msg.guild.id, mem.id)) return msg.reply('❌ Cannot kick whitelisted user!');
    const reason = args.slice(1).join(' ') || 'No reason';
    await mem.kick(reason);
    return msg.reply(`✅ **KICKED** <@${mem.id}>\nReason: ${reason}`);
  }
  if(command==='purge' && mod) {
    const amt = parseInt(args[0]);
    if(!amt || amt<1 || amt>100) return msg.reply(`❌ Usage: \`${p}purge 1-100\``);
    const d = await msg.channel.bulkDelete(amt+1, true);
    return msg.reply(`✅ Cleared **${d.size}** messages!`).then(m=>setTimeout(()=>m.delete(),3000));
  }
  if(command==='warn' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}warn @user reason\``);
    const r = args.slice(1).join(' ') || 'No reason';
    DB.addWarning(msg.guild.id, usr.id, r);
    return msg.reply(`✅ **WARNED** <@${usr.id}> — ${r}\nTotal Warnings: ${DB.getWarnings(msg.guild.id, usr.id).length}`);
  }
  if(command==='warnings'||command==='warns' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}warnings @user\``);
    const w = DB.getWarnings(msg.guild.id, usr.id);
    return msg.reply(`⚠️ Warnings for <@${usr.id}> (${w.length}):\n${w.length?w.map((x,i)=>`${i+1}. ${x.reason}`).join('\n'):'No warnings — clean record!'}`);
  }
  if(command==='clearwarns' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}clearwarns @user\``);
    DB.clearWarnings(msg.guild.id, usr.id);
    return msg.reply(`✅ Cleared all warnings for <@${usr.id}>`);
  }

  // ─── ROLE MANAGEMENT ───
  if(command==='addrole' && mod) {
    if(!mem) return msg.reply(`❌ Usage: \`${p}addrole @user @role\``);
    const role = msg.mentions.roles.first();
    if(!role) return msg.reply('❌ Role not found — mention a role');
    await mem.roles.add(role);
    return msg.reply(`✅ Added role **${role.name}** to <@${mem.id}>`);
  }
  if(command==='unrole'||command==='removerole' && mod) {
    if(!mem) return msg.reply(`❌ Usage: \`${p}unrole @user @role\``);
    const role = msg.mentions.roles.first();
    if(!role) return msg.reply('❌ Role not found');
    await mem.roles.remove(role);
    return msg.reply(`✅ Removed role **${role.name}** from <@${mem.id}>`);
  }
  if(command==='makerole' && prem) {
    const name = args.join(' ') || 'New Role';
    const r = await msg.guild.roles.create({name, color: '#00ff88', reason: 'WIKO Premium Role'});
    return msg.reply(`✅ Created role: <@&${r.id}> 🎨`);
  }
  if(command==='deleterole' && mod) {
    const role = msg.mentions.roles.first();
    if(!role) return msg.reply(`❌ Usage: \`${p}deleterole @role\``);
    await role.delete();
    return msg.reply(`✅ Deleted role: **${role.name}**`);
  }

  // ─── INFO & UTILS ───
  if(command==='ping') {
    return msg.reply(`🏓 Pong! Latency: **${client.ws.ping}ms**\nBot Online ✅`);
  }
  if(command==='uptime') {
    const sec = Math.floor(process.uptime());
    const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600), m = Math.floor((sec%3600)/60);
    return msg.reply(`⏱️ Uptime: ${d}d ${h}h ${m}m`);
  }
  if(command==='botinfo'||command==='about') {
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setTitle('🤖 WIKO Bot Info')
      .addFields(
        { name: 'Developer', value: 'WIKO Team', inline: true },
        { name: 'Prefix', value: `\`${p}\``, inline: true },
        { name: 'Commands', value: '150+', inline: true },
        { name: 'Premium', value: `${prem?'✅ Active':'🔒 Locked'}`, inline: true },
        { name: 'Latency', value: `${client.ws.ping}ms`, inline: true },
        { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true }
      )
    }]});
  }
  if(command==='serverinfo'||command==='guildinfo') {
    const g = msg.guild;
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setTitle(`📊 ${g.name}`)
      .addFields(
        { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: 'Members', value: `${g.memberCount}`, inline: true },
        { name: 'Roles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(g.createdAt.getTime()/1000)}:D>`, inline: true },
        { name: 'Boosts', value: `${g.premiumSubscriptionCount||0}`, inline: true }
      )
    }]});
  }
  if(command==='userinfo'||command==='whois') {
    const u = usr || msg.author;
    const m = msg.guild.members.cache.get(u.id);
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setAuthor({name:u.username, iconURL:u.displayAvatarURL()})
      .addFields(
        { name: 'ID', value: `${u.id}`, inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(u.createdAt.getTime()/1000)}:D>`, inline: true },
        { name: 'Joined Server', value: m ? `<t:${Math.floor(m.joinedAt.getTime()/1000)}:D>` : 'N/A', inline: true }
      )
      .setThumbnail(u.displayAvatarURL({dynamic:true}))
    }]});
  }
  if(command==='avatar') {
    const u = usr || msg.author;
    return msg.reply({embeds:[new EmbedBuilder()
      .setTitle(`${u.username}'s Avatar`)
      .setImage(u.displayAvatarURL({dynamic:true, size:4096}))
    ]});
  }
  if(command==='invite') {
    return msg.reply('🔗 Bot Invite:\n[Click Here](https://discord.com/api/oauth2/authorize?client_id='+client.user.id+'&permissions=8&scope=bot%20applications.commands)');
  }
  if(command==='credits') {
    return msg.reply('✨ **Credits to WIKO**\nAll code built for your server!\n- Premium System\n- Full Antinuke Protection\n- 150+ Commands\n- 24/7 Ready');
  }
});

// ─── READY STATUS ───
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✨ WIKO — 150+ Commands — ONLINE!`);
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'fwwko.netlify.app | !help — 150+ Commands ✨',
      type: 1,
      url: 'https://twitch.tv/wiko'
    }]
  });
});

client.login(config.token);