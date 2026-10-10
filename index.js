const {
  Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder
} = require('discord.js');
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
    GatewayIntentBits.MessageContent
  ]
});

// ─── DATABASE ───
const DB = {
  data: {
    prefixes: {}, whitelist: {}, premium: {}, premiumCodes: {}, antinuke: {},
    economy: {}, afk: {}, autoresponders: {}
  },
  load() { try { Object.assign(this.data, JSON.parse(fs.readFileSync('./db.json'))); } catch {} },
  save() { fs.writeFileSync('./db.json', JSON.stringify(this.data, null, 2)); },

  getPrefix(gid) { return this.data.prefixes[gid] || config.defaultPrefix; },
  setPrefix(gid, p) { this.data.prefixes[gid] = p; this.save(); },

  isWhitelisted(gid, uid) { return (this.data.whitelist[gid] || []).includes(uid) || uid === config.ownerId; },
  whitelistAdd(gid, uid) { if(!this.data.whitelist[gid]) this.data.whitelist[gid] = []; this.data.whitelist[gid].push(uid); this.save(); },
  whitelistRemove(gid, uid) { this.data.whitelist[gid] = (this.data.whitelist[gid]||[]).filter(id=>id!==uid); this.save(); },

  isPremium(gid) { return !!this.data.premium[gid]; },
  createPremiumCode(by) { const c='WIKO-'+Math.random().toString(36).slice(2,10).toUpperCase(); this.data.premiumCodes[c]={by,used:false}; this.save(); return c; },
  redeemCode(c,gid) { const x=this.data.premiumCodes[c]; if(!x||x.used)return false; x.used=true; this.data.premium[gid]=true; this.save(); return true; },

  getAntinuke(gid) { return this.data.antinuke[gid] || {enabled:true,strict:false}; },
  setAntinuke(gid,o) { this.data.antinuke[gid]={...this.getAntinuke(gid),...o}; this.save(); },

  getBal(uid) { if(!this.data.economy[uid])this.data.economy[uid]={w:0,b:0,d:0}; return this.data.economy[uid]; },
  addBal(uid,a) { this.getBal(uid).w+=a; this.save(); },

  getARs(gid) { return this.data.autoresponders[gid] || {}; },
  addAR(gid, trigger, reply) {
    if(!this.data.autoresponders[gid]) this.data.autoresponders[gid] = {};
    this.data.autoresponders[gid][trigger.toLowerCase().trim()] = { reply, enabled: true };
    this.save();
  },
  removeAR(gid, trigger) {
    const t = trigger.toLowerCase().trim();
    if(this.data.autoresponders[gid]?.[t]) {
      delete this.data.autoresponders[gid][t];
      this.save();
      return true;
    }
    return false;
  },
  toggleAR(gid, trigger, state) {
    const t = trigger.toLowerCase().trim();
    if(this.data.autoresponders[gid]?.[t]) {
      this.data.autoresponders[gid][t].enabled = state;
      this.save();
      return true;
    }
    return false;
  },
  clearARs(gid) {
    this.data.autoresponders[gid] = {};
    this.save();
  },
  matchAR(gid, text) {
    const ars = this.getARs(gid);
    const lower = text.toLowerCase();
    for(const [t, data] of Object.entries(ars)) {
      if(data.enabled && lower.includes(t)) return data.reply;
    }
    return null;
  },

  setAFK(uid,m) { this.data.afk[uid]={m,t:Date.now()}; this.save(); },
  remAFK(uid) { delete this.data.afk[uid]; this.save(); }
};
DB.load();

// ─── ANTINUKE PROTECTION ───
client.on('guildMemberRemove', async m=>{
  const c=DB.getAntinuke(m.guild.id); if(!c.enabled||!c.strict)return;
  const a=(await m.guild.fetchAuditLogs({limit:1}).catch(()=>null))?.entries?.first();
  if(!a||!['Member Ban','Member Kick'].includes(a.actionType))return;
  const ex=a.executor; if(!ex||DB.isWhitelisted(m.guild.id,ex.id))return;
  try{await m.guild.members.ban(ex.id,{reason:'⚠️ Antinuke: Unwhitelisted action'});}catch{}
});

// ─── MAIN MESSAGE HANDLER ───
client.on('messageCreate', async msg=>{
  if(!msg.guild||msg.author.bot)return;
  const p=DB.getPrefix(msg.guild.id);

  // AUTO-REPLY CHECK
  const arReply = DB.matchAR(msg.guild.id, msg.content);
  if(arReply && !msg.content.startsWith(p)) {
    return msg.reply(arReply);
  }

  // AFK Check
  if(DB.data.afk[msg.author.id]) DB.remAFK(msg.author.id);
  for(const [uid, d] of Object.entries(DB.data.afk)) {
    if(msg.mentions.users.has(uid)) {
      return msg.reply(`💤 <@${uid}> is AFK: ${d.m}`);
    }
  }

  if(!msg.content.startsWith(p)) return;
  const [cmd, ...args] = msg.content.slice(p.length).trim().split(/\s+/);
  const usr = msg.mentions.users.first();
  const mem = msg.mentions.members.first();
  const prem = DB.isPremium(msg.guild.id);

  // ═══════════════ HELP ═══════════════
  if(cmd==='help'||cmd==='commands'){
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setTitle('📋 WIKO — All-In-One Bot')
      .setDescription(`**Prefix:** \`${p}\` | Premium: ${prem?'✅ ACTIVE':'🔒 LOCKED'}`)
      .addFields(
        {name:'🔐 Premium', value:'`gencode` (Owner Only) | `activate <code>`'},
        {name:'🛡️ Antinuke', value:'`antinuke enable/disable/strict` | `whitelist add/remove/list` | `multiwl/multiunwl`'},
        {name:'⚙️ Auto-Reply', value:'`ar add <keyword> <reply>` | `ar list` | `ar remove <keyword>` | `ar toggle` | `ar clear`'},
        {name:'⚖️ Moderation', value:'`ban/kick/unban` | `purge` | `warn/warnings/clearwarns`'},
        {name:'🎭 Roles', value:'`makerole/deleterole` ✅ Premium | `addrole/removerole`'},
        {name:'💰 Economy', value:'`balance/daily/transfer`'},
        {name:'🎉 Fun & Utility', value:'`8ball/say/avatar/afk/ping`'},
        {name:'⚙️ Settings', value:'`setprefix` | `setbotpfp` ✅ Premium'}
      )
      .setFooter({text:'✨ Credits to WIKO — All-In-One Bot ✨'})
    ]});
  }

  // ═══════════════ AUTO-REPLY ═══════════════
  if(cmd==='autoresponder'||cmd==='ar'){
    const sub = args[0];
    const hasPerm = DB.isWhitelisted(msg.guild.id, msg.author.id) ||
                    (prem && msg.member.permissions.has('ManageGuild'));

    if(sub==='add'){
      if(!hasPerm) return msg.reply('❌ No permission — Premium or Whitelisted only');
      const trigger = args[1];
      const reply = args.slice(2).join(' ');
      if(!trigger || !reply) {
        return msg.reply(`✅ Usage: \`${p}ar add <keyword> <your reply>\`\nExample: \`${p}ar add hello Hi there! 👋\`\n\n✨ Credits to WIKO`);
      }
      DB.addAR(msg.guild.id, trigger, reply);
      return msg.reply(`✅ Auto-Reply Added!\n🔑 Trigger: \`${trigger}\`\n💬 Reply: ${reply}\n\n✨ Credits to WIKO`);
    }

    if(sub==='remove'||sub==='del'){
      if(!hasPerm) return msg.reply('❌ No permission');
      const trigger = args[1];
      if(!trigger) return msg.reply(`Usage: \`${p}ar remove <keyword>\``);
      if(DB.removeAR(msg.guild.id, trigger)) {
        return msg.reply(`✅ Removed: \`${trigger}\`\n\n✨ Credits to WIKO`);
      }
      return msg.reply(`❌ Not found: \`${trigger}\``);
    }

    if(sub==='list'||sub==='ls'){
      const ars = DB.getARs(msg.guild.id);
      const entries = Object.entries(ars);
      if(!entries.length) return msg.reply('📋 No auto-replies set yet\n\n✨ Credits to WIKO');
      return msg.reply({embeds:[new EmbedBuilder()
        .setTitle('⚙️ Auto-Reply List')
        .setDescription(entries.map(([t,d],i)=>
          `${i+1}. **${t}** ${d.enabled?'✅':'🔴'}\n   ↳ ${d.reply}`
        ).join('\n\n'))
        .setFooter({text:'✨ Credits to WIKO'})
      ]});
    }

    if(sub==='toggle'||sub==='onoff'){
      if(!hasPerm) return msg.reply('❌ No permission');
      const trigger = args[1];
      const state = args[2]==='on';
      if(!trigger) return msg.reply(`Usage: \`${p}ar toggle <keyword> on/off\``);
      if(DB.toggleAR(msg.guild.id, trigger, state)) {
        return msg.reply(`✅ \`${trigger}\` — turned ${state?'✅ ON':'🔴 OFF'}\n\n✨ Credits to WIKO`);
      }
      return msg.reply(`❌ Not found: \`${trigger}\``);
    }

    if(sub==='clear'||sub==='deleteall'){
      if(!hasPerm) return msg.reply('❌ No permission');
      DB.clearARs(msg.guild.id);
      return msg.reply('✅ Cleared ALL auto-replies\n\n✨ Credits to WIKO');
    }

    return msg.reply({embeds:[new EmbedBuilder()
      .setTitle('⚙️ Auto-Reply Commands')
      .addFields(
        {name:'Add', value:`\`${p}ar add <keyword> <reply>\``},
        {name:'Remove', value:`\`${p}ar remove <keyword>\``},
        {name:'List', value:`\`${p}ar list\``},
        {name:'Toggle', value:`\`${p}ar toggle <keyword> on/off\``},
        {name:'Clear All', value:`\`${p}ar clear\``}
      )
      .setFooter({text:'✨ Credits to WIKO — Auto-Reply System'})
    ]});
  }

  // ═══════════════ PREMIUM ═══════════════
  if(cmd==='gencode'){
    if(msg.author.id!==config.ownerId) return msg.reply('❌ Owner only');
    return msg.reply(`🔑 Premium Code Generated:\n\`${DB.createPremiumCode(msg.author.id)}\`\n\n✨ Credits to WIKO`);
  }
  if(cmd==='activate'){
    if(DB.redeemCode(args[0]?.toUpperCase(), msg.guild.id))
      return msg.reply('✅ **PREMIUM ACTIVATED!**\nUnlocked: Auto-Reply, Strict Antinuke, Makerole, SetBotPFP\n\n✨ Credits to WIKO');
    return msg.reply('❌ Invalid or used code — ask Bot Owner\n\n✨ Credits to WIKO');
  }

  // ═══════════════ SETTINGS ═══════════════
  if(cmd==='setprefix'){
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    if(!args[0]) return msg.reply(`Current Prefix: \`${p}\`\n\n✨ Credits to WIKO`);
    DB.setPrefix(msg.guild.id, args[0]);
    return msg.reply(`✅ Prefix changed to: \`${args[0]}\`\n\n✨ Credits to WIKO`);
  }

  // ═══════════════ ANTINUKE ═══════════════
  if(cmd==='antinuke'){
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    if(args[0]==='enable'){ DB.setAntinuke(msg.guild.id,{enabled:true}); return msg.reply('✅ Antinuke Protection ENABLED\n\n✨ Credits to WIKO'); }
    if(args[0]==='disable'){ DB.setAntinuke(msg.guild.id,{enabled:false}); return msg.reply('⚠️ Antinuke Protection DISABLED\n\n✨ Credits to WIKO'); }
    if(args[0]==='strict'){
      if(!prem) return msg.reply('🔒 Premium Required — use `!activate <code>`\n\n✨ Credits to WIKO');
      DB.setAntinuke(msg.guild.id,{strict:args[1]==='on'});
      return msg.reply(`✅ Strict Mode: ${args[1]==='on'?'🔴 ON — Auto-ban attackers':'🟡 OFF — Monitor only'}\n\n✨ Credits to WIKO`);
    }
  }
  if(cmd==='whitelist'&&args[0]==='add'){
    if(!usr) return msg.reply(`Usage: ${p}whitelist add @user`);
    DB.whitelistAdd(msg.guild.id, usr.id); return msg.reply(`✅ Whitelisted: ${usr.username}\n\n✨ Credits to WIKO`);
  }
  if(cmd==='whitelist'&&args[0]==='remove'){
    if(!usr) return msg.reply(`Usage: ${p}whitelist remove @user`);
    DB.whitelistRemove(msg.guild.id, usr.id); return msg.reply(`✅ Removed from whitelist: ${usr.username}\n\n✨ Credits to WIKO`);
  }
  if(cmd==='multiwl'){
    let n=0; args.forEach(id=>{ if(id.length>10){ DB.whitelistAdd(msg.guild.id, id.replace(/\D/g,'')); n++; }});
    return msg.reply(`✅ Whitelisted ${n} users\n\n✨ Credits to WIKO`);
  }
  if(cmd==='multiunwl'){
    let n=0; args.forEach(id=>{ if(id.length>10){ DB.whitelistRemove(msg.guild.id, id.replace(/\D/g,'')); n++; }});
    return msg.reply(`✅ Unwhitelisted ${n} users\n\n✨ Credits to WIKO`);
  }

  // ═══════════════ MODERATION ═══════════════
  if(cmd==='purge'){
    if(!msg.member.permissions.has('ManageMessages')) return;
    const n=parseInt(args[0]); if(isNaN(n)||n<1||n>100) return msg.reply('Use: 1-100\n\n✨ Credits to WIKO');
    const d=await msg.channel.bulkDelete(n,true).catch(()=>null);
    return msg.reply(`✅ Deleted ${d?.size||0} messages\n\n✨ Credits to WIKO`).then(m=>setTimeout(()=>m.delete(),3000));
  }
  if(cmd==='ban'){
    if(!msg.member.permissions.has('BanMembers')) return;
    if(!mem) return msg.reply(`Usage: ${p}ban @user [reason]`);
    await mem.ban({reason:args.slice(1).join(' ')||'No reason'}).catch(()=>null);
    return msg.reply(`✅ Banned: ${usr.username}\n\n✨ Credits to WIKO`);
  }
  if(cmd==='unban'){
    if(!msg.member.permissions.has('BanMembers')) return;
    try{ await msg.guild.bans.remove(args[0]); return msg.reply('✅ Unbanned\n\n✨ Credits to WIKO'); }
    catch{ return msg.reply('❌ Not found\n\n✨ Credits to WIKO'); }
  }
  if(cmd==='kick'){
    if(!msg.member.permissions.has('KickMembers')) return;
    if(!mem) return msg.reply(`Usage: ${p}kick @user`);
    await mem.kick().catch(()=>null);
    return msg.reply(`✅ Kicked: ${usr.username}\n\n✨ Credits to WIKO`);
  }

  // ═══════════════ ROLES ═══════════════
  if(cmd==='makerole'){
    if(!prem) return msg.reply('🔒 Premium Only — `!activate <code>`\n\n✨ Credits to WIKO');
    if(!msg.member.permissions.has('ManageRoles')) return;
    const n=args.join(' ')||'New Role';
    const r=await msg.guild.roles.create({name:n}).catch(()=>null);
    return msg.reply(r?`✅ Created Role: **${r.name}**\n\n✨ Credits to WIKO`:'❌ Failed\n\n✨ Credits to WIKO');
  }
  if(cmd==='deleterole'){
    if(!prem) return msg.reply('🔒 Premium Only — `!activate <code>`\n\n✨ Credits to WIKO');
    if(!msg.member.permissions.has('ManageRoles')) return;
    const r=msg.mentions.roles.first();
    if(!r) return msg.reply(`Usage: ${p}deleterole @Role`);
    await r.delete().catch(()=>null);
    return msg.reply(`✅ Deleted Role: **${r.name}**\n\n✨ Credits to WIKO`);
  }
  if(cmd==='addrole'){
    if(!msg.member.permissions.has('ManageRoles')) return;
    const r=msg.mentions.roles.last();
    if(!usr||!r) return msg.reply(`Usage: ${p}addrole @user @Role`);
    await mem.roles.add(r).catch(()=>null);
    return msg.reply(`✅ Added **${r.name}** to ${usr.username}\n\n✨ Credits to WIKO`);
  }
  if(cmd==='removerole'){
    if(!msg.member.permissions.has('ManageRoles')) return;
    const r=msg.mentions.roles.last();
    if(!usr||!r) return msg.reply(`Usage: ${p}removerole @user @Role`);
    await mem.roles.remove(r).catch(()=>null);
    return msg.reply(`✅ Removed **${r.name}** from ${usr.username}\n\n✨ Credits to WIKO`);
  }

  // ═══════════════ ECONOMY ═══════════════
  if(cmd==='balance'||cmd==='bal'){
    const b=DB.getBal(usr?.id||msg.author.id);
    return msg.reply(`💰 **${(usr||msg.author).username}**\nWallet: \`$${b.w}\`\nBank: \`$${b.b}\`\n\n✨ Credits to WIKO`);
  }
  if(cmd==='daily'){
    const last = DB.getBal(msg.author.id).d || 0;
    if(Date.now()-last < 86400000) return msg.reply('⏰ Come back in 24 hours!\n\n✨ Credits to WIKO');
    DB.addBal(msg.author.id, 500);
    DB.getBal(msg.author.id).d = Date.now();
    return msg.reply('✅ +$500 Daily Claimed!\n\n✨ Credits to WIKO');
  }
  if(cmd==='transfer'||cmd==='pay'){
    const amt=parseInt(args[1]);
    if(!usr||isNaN(amt)||amt<1) return msg.reply(`Usage: ${p}transfer @user 100`);
    if(DB.getBal(msg.author.id).w < amt) return msg.reply('❌ Insufficient Funds\n\n✨ Credits to WIKO');
    DB.addBal(msg.author.id, -amt); DB.addBal(usr.id, amt);
    return msg.reply(`✅ Transferred $${amt} to ${usr.username}\n\n✨ Credits to WIKO`);
  }

  // ═══════════════ FUN ═══════════════
  if(cmd==='afk'){ DB.setAFK(msg.author.id, args.join(' ')||'AFK'); return msg.reply('💤 AFK Status Set\n\n✨ Credits to WIKO'); }
  if(cmd==='8ball'){
    if(!args.length) return msg.reply('Ask a question!\n\n✨ Credits to WIKO');
    const a=['Yes ✅','No ❌','Maybe 🤔','Definitely ✅','Never ❌','Soon ⏳'];
    return msg.reply(`🎱 ${a[Math.floor(Math.random()*a.length)]}\n\n✨ Credits to WIKO`);
  }
  if(cmd==='say'){ if(!args.length)return; return msg.channel.send(args.join(' ')+'\n\n✨ Credits to WIKO'); }
  if(cmd==='avatar'||cmd==='pfp'){ return msg.reply((usr||msg.author).displayAvatarURL({size:1024,dynamic:true})+'\n\n✨ Credits to WIKO'); }
  if(cmd==='ping'){ return msg.reply(`🏓 Pong! **${Date.now()-msg.createdTimestamp}ms**\n\n✨ Credits to WIKO`); }
  if(cmd==='setbotpfp'){
    if(!prem) return msg.reply('🔒 Premium Only — `!activate <code>`\n\n✨ Credits to WIKO');
    const u=args[0]||msg.attachments.first()?.url;
    if(!u) return msg.reply(`Usage: ${p}setbotpfp <image-URL>\n\n✨ Credits to WIKO`);
    try{ await client.user.setAvatar(u); return msg.reply('✅ Bot Avatar Updated\n\n✨ Credits to WIKO'); }
    catch{ return msg.reply('❌ Failed — use direct .jpg/.png link\n\n✨ Credits to WIKO'); }
  }
});

// ─── READY ───
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✨ Credits to WIKO — All-In-One Bot Online!`);
  console.log(`✅ Auto-Reply System ACTIVE`);

  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'fwwko.netlify.app |Type !help to see Available Commands!',
      type: 1,
      url: 'https://twitch.tv/wiko'
    }]
  });
});

client.login(config.token);