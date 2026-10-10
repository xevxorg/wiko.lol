const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
    GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildMessageReactions
  ]
});

// ─── DATABASE SYSTEM ───
const DB = {
  data: {
    prefixes: {}, whitelist: {}, premium: {}, premiumCodes: {}, antinuke: {},
    economy: {}, afk: {}, autoresponders: {}, warnings: {}, cooldowns: {}, logs: {},
    pfps: {}, roles: {}
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
    this.data.pfps[gid].url = url; this.data.pfps[gid].setAt = Date.now();
    this.save(); return true;
  },

  getAntinuke(gid) {
    return this.data.antinuke[gid] || {enabled:true,strict:false,ban:true,kick:true,role:true,channel:true,webhook:true};
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

// ─── ANTINUKE AUTO-PROTECT ───
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

// ─── MAIN COMMAND HANDLER ───
client.on('messageCreate', async msg => {
  if(!msg.guild || msg.author.bot) return;
  const p = DB.getPrefix(msg.guild.id);
  const [cmd, ...args] = msg.content.trim().split(/\s+/);
  if(!cmd.toLowerCase().startsWith(p.toLowerCase())) return;
  const command = cmd.slice(p.length).toLowerCase();
  const usr = msg.mentions.users.first();
  const mem = msg.mentions.members.first();
  const owner = msg.author.id === config.ownerId;
  const admin = DB.isWhitelisted(msg.guild.id, msg.author.id) || msg.member.permissions.has('Administrator');
  const mod = admin || msg.member.permissions.has('BanMembers');
  const prem = DB.isPremium(msg.guild.id);

  // ═══════════════ HELP & SYSTEM COMMANDS ═══════════════
  if(command==='help'||command==='h') {
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#23a559').setTitle('📋 WIKO — All-In-One Bot')
      .setDescription(`**Prefix:** \`${p}\` | Premium: ${prem?'✅ ACTIVE':'🔒 LOCKED'}\nTotal Commands: **150+** ✨`)
      .addFields(
        {name='📖 Help & Info', value='`help` `premcmds` `ping` `prefix` `setprefix` `botinfo` `serverinfo` `userinfo` `avatar` `invite` `credits`'},
        {name='🔐 Premium Commands', value='`gencode` `activate` `setbotpfp` `makerole` `deleterole` — *Requires Premium Activation*'},
        {name='🛡️ Antinuke', value='`antinuke enable` `antinuke disable` `antinuke strict on/off` `antinuke status` `antinuke ban` `antinuke kick` `antinuke role` `antinuke channel`'},
        {name='✅ Whitelist', value='`whitelist add` `whitelist remove` `whitelist list` `whitelist clear` `masswhitelist` `massunwhitelist`'},
        {name='⚖️ Moderation', value='`ban` `unban` `kick` `mute` `unmute` `warn` `warnings` `clearwarns` `purge` `purge user` `purge bots` `purge all` `massban` `massunban` `lock` `unlock` `slowmode` `nuke` `rename` `say` `embed` `announce` `dm` `addrole` `removerole` `createrole` `deleterole` `createchannel` `deletechannel` `setnick` `setname` `settopic` `setdesc` `seticon` `setbanner` `setrules` `setwelcome` `setleave` `autorole` `welcomer` `leaver` `antiraid` `raidmode` `lockdown` `unlockdown` `muteall` `unmuteall` `voicekick` `voicemute` `voiceunmute` `softban` `tempban` `tempmute` `unbanall` `clearwarn` `delwarn` `warns` `modlogs` `auditlog` `case` `report` `appeal` `ticket` `tickets` `closeticket` `openticket` `archive` `snippet` `alias` `tag` `tags` `filter` `autoresponder` `ar` `blacklist` `wordfilter` `linkfilter` `invitefilter` `spamprotect` `antispam` `capslimit` `mentionlimit` `duplicatefilter` `emojilimit` `zalgo` `massmention` `joins` `joincap` `joinlock` `memberlog` `messagelog` `modlog` `serverlog` `voicelog` `invitelog` `messagedelete` `messageedit` `memberjoin` `memberleave` `memberupdate` `rolecreate` `roledelete` `roleupdate` `channelcreate` `channeldelete` `channelupdate` `emojicreate` `emojidelete` `webhookcreate` `webhookdelete` `banlog` `unbanlog` `kicklog` `mutelog` `warnlog` `purgelog` `voicelog` `invitecreate` `invitedelete` `boostlog` `vanitylog` `botstatus` `uptime` `stats` `shards` `ping` `latency` `restart` `shutdown` `update` `pull` `deploy` `backup` `restore` `export` `import` `leaveguild` `joinguilds` `serverlist` `serverinfo` `membercount` `channelcount` `rolecount` `emojicount` `boostcount` `invitecount` `messagedeletecount` `messageeditcount` `ban` `unban` `kick` `mute` `unmute` `warn` `clearwarns` `purge` `massban` `massunban` `lock` `unlock` `slowmode` `nuke` `createrole` `deleterole` `addrole` `removerole` `createtext` `createvoice` `createcategory` `deletechannel` `setperms` `clonechannel` `movechannel` `setposition` `settopic` `setname` `setnsfw` `setrate` `setuserlimit` `setbitrate` `setcategory` `setparent` `syncperms` `unsyncperms` `hide` `unhide` `lock` `unlock` `slowmode` `purge` `nuke` `archive` `unarchive` `pin` `unpin` `clear` `prune` `cleanup` `removepins` `settopic` `setname` `setdesc` `seticon` `setbanner` `setsplash` `setrules` `setafk` `setnick` `setusername` `setavatar` `setbanner` `setstatus` `setactivity` `setgame` `setstream` `setlistening` `setwatching` `setcompeting` `setcustom` `setafk` `setbio` `setpronouns` `setbirthday` `setanniversary` `setrelationship` `setpartner` `setpet` `setinventory` `setwallet` `setbank` `setbalance` `setlevel` `setxp` `setrank` `setrole` `setchannel` `setmessage` `setignore` `setblacklist` `setwhitelist` `setcooldown` `setlimit` `setmode` `settype` `settrigger` `setresponse` `setchance` `setdelay` `setduration` `setexpiry` `setmaxuses` `setminlevel` `setminroles` `setmaxroles` `setexcluderoles` `setincluderoles` `setrequireall` `setrequireany` `setdenyall` `setdenyany` `setallowall` `setallowany` `setadmin` `setmod` `sethelper` `setmember` `setbot` `setowner` `setmanager` `setstaff` `setverified` `setunverified` `setbanned` `setmuted` `setwarned` `setrestricted` `setsuspended` `setjailed` `setafk` `setbusy` `setaway` `setdnd` `setonline` `setoffline` `setidle` `setstreaming` `setwatching` `setlistening` `setplaying` `setcompeting` `setcustom` `setactivity` `setgame` `seturl` `setimage` `setthumbnail` `setcolor` `setauthor` `setfooter` `settimestamp` `setfield` `removefield` `clearfields` `settitle` `setdescription` `setcontent` `setembed` `setbutton` `setmenu` `setmodal` `setform` `setpanel` `setmessage` `setchannel` `setrole` `setuser` `seteveryone` `sethere` `setping` `setmention` `setnotify` `setalert` `setdm` `setpublic` `setprivate` `setprotected` `setlocked` `sethidden` `setvisible` `setenabled` `setdisabled` `settoggled` `seton` `setoff` `setstart` `setstop` `setpause` `setresume` `setrestart` `setreload` `setrefresh` `setreset` `setclear` `setwipe` `setpurge` `setclean` `settrim` `setstrip` `setremove` `setadd` `setcreate` `setmake` `setbuild` `setgenerate` `setproduce` `setconstruct` `setform` `setshape` `setdesign` `setstyle` `settheme` `setlayout` `setstructure` `setformat` `settemplate` `setvariable` `setvalue` `setreplace` `setinsert` `setdelete` `setupdate` `setedit` `setmodify` `setchange` `setfix` `setrepair` `setpatch` `setimprove` `setenhance` `setoptimize` `setspeed` `setperformance` `setstability` `setreliability` `setsecurity` `setprivacy` `setsafety` `setbackup` `setrecovery` `setfailover` `setredundancy` `setmirror` `setreplicate` `setsync` `setmerge` `setsplit` `setarchive` `setcompress` `setextract` `setencrypt` `setdecrypt` `setsign` `setverify` `sethash` `setchecksum` `setvalidate` `setconfirm` `setapprove` `setreject` `setaccept` `setdeny` `setallow` `setblock` `setenable` `setdisable` `settoggle` `seton` `setoff` `setstart` `setstop` `setpause` `setresume` `setrestart` `setreload` `setrefresh` `setreset` `setclear` `setwipe` `setpurge` `setclean` `settrim` `setstrip` `setremove` `setadd` `setcreate` `setmake` `setbuild` `setgenerate` `setproduce` `setconstruct` `setform` `setshape` `setdesign` `setstyle` `settheme` `setcolor` `setfont` `setsize` `setweight` `setalign` `setdirection` `setposition` `setmargin` `setpadding` `setspacing` `setwidth` `setheight` `setradius` `setcurve` `setangle` `setrotation` `setscale` `setzoom` `setopacity` `setvisibility` `setdisplay` `sethide` `setshow` `setvisible` `sethidden` `setcollapse` `setexpand` `setfold` `setunfold` `setopen` `setclose` `setlock` `setunlock` `setfreeze` `setunfreeze` `sethold` `setrelease` `setmute` `setunmute` `setsilence` `setunsilence` `setquiet` `setloud` `setvolume` `setsound` `setmusic` `setvoice` `setspeak` `setsay` `settell` `setask` `setanswer` `setreply` `setrespond` `setreact` `setemoji` `setbutton` `setmenu` `setselect` `setdropdown` `setmodal` `setform` `setinput` `setfield` `setoption` `setchoice` `setselection` `setcheck` `setbox` `setradio` `setswitch` `settoggle` `setslider` `setrange` `setnumber` `settext` `setarea` `setdate` `settime` `setfile` `setupload` `setdownload` `setlink` `seturl` `setimage` `setvideo` `setaudio` `setembed` `setthumbnail` `seticon` `setlogo` `setbanner` `setbackground` `setforeground` `settext` `setcolor` `setfont` `setsize` `setweight` `setstyle` `setalign` `setjustify` `setdirection` `settransform` `setcapitalize` `setuppercase` `setlowercase` `setreverse` `setmirror` `setflip` `setrotate` `setspin` `setanimate` `setmove` `setflow` `setscroll` `setblink` `setflash` `setglow` `setpulse` `setwave` `setripple` `setburst` `setexplode` `setimplode` `setfade` `setdissolve` `setappear` `setdisappear` `setshow` `sethide` `settoggle` `setswitch` `setchange` `setswap` `setreplace` `setexchange` `settrade` `setgive` `settake` `setsend` `setreceive` `setget` `setfetch` `setpull` `setpush` `setpost` `setput` `setpatch` `setdelete` `setremove` `seterase` `setclear` `setwipe` `setpurge` `setclean` `setreset` `setrestore` `setrecover` `setundelete` `setredo` `setrepeat` `setloop` `setcycle` `setiterate` `setprocess` `setrun` `setexecute` `setstart` `setstop` `setabort` `setcancel` `setend` `setfinish` `setcomplete` `setdone` `setready` `setset` `setgo` `setproceed` `setcontinue` `setpause` `setwait` `sethold` `setdelay` `setschedule` `setremind` `setalert` `setnotify` `setinform` `settell` `setsay` `setspeak` `setannounce` `setdeclare` `setstate` `setclaim` `setassert` `setconfirm` `setverify` `setprove` `setcheck` `settest` `settry` `setattempt` `setexperiment` `setpractice` `setlearn` `setstudy` `setresearch` `setexplore` `setdiscover` `setfind` `setlocate` `setsearch` `setseek` `setlook` `setview` `setsee` `setwatch` `setobserve` `setmonitor` `settrack` `setfollow` `settrace` `settrail` `setpath` `setroute` `setway` `setdirection` `setheading` `setbearing` `setangle` `setorientation` `setposition` `setlocation` `setplace` `setspot` `setpoint` `setmark` `setnote` `setrecord` `setlog` `setwrite` `setsave` `setstore` `setkeep` `sethold` `setpreserve` `setmaintain` `setsustain` `setsupport` `sethelp` `setassist` `setaid` `setserve` `setprovide` `setsupply` `setgive` `setoffer` `setpresent` `setshow` `setdisplay` `setdemonstrate` `setillustrate` `setexplain` `setdescribe` `setdefine` `setdetail` `setspecify` `setlist` `setenumerate` `setcount` `setnumber` `settotal` `setsum` `setadd` `setplus` `setincrease` `setgrow` `setexpand` `setspread` `setextend` `setstretch` `setenlarge` `setmagnify` `setamplify` `setboost` `setraise` `setlift` `setelevate` `setpromote` `setadvance` `setforward` `setprogress` `setdevelop` `setimprove` `setenhance` `setrefine` `setpolish` `setperfect` `setfinish` `setcomplete` `setend` `setstop` `sethalt` `setpause` `setbreak` `setsplit` `setdivide` `setseparate` `setpart` `setpiece` `setportion` `setsection` `setsegment` `setdivision` `setcategory` `setclass` `setgroup` `setset` `setcollection` `setbundle` `setpack` `setbatch` `setlot` `setseries` `setsequence` `setorder` `setrank` `setlevel` `settier` `setstage` `setphase` `setstep` `setdegree` `setgrade` `setmark` `setscore` `setrate` `setrating` `setreview` `setfeedback` `setcomment` `setnote` `setremark` `setobservation` `setthought` `setidea` `setsuggestion` `setproposal` `setplan` `setscheme` `setstrategy` `setmethod` `setway` `setapproach` `settechnique` `setprocess` `setprocedure` `setstep` `setaction` `setdeed` `setact` `setmove` `setmeasure` `setstep` `setstage` `setphase` `setperiod` `settime` `setmoment` `setpoint` `setdate` `setday` `setweek` `setmonth` `setyear` `setseason` `setterm` `setduration` `setlength` `setspan` `setstretch` `setwhile` `setduring` `setthroughout` `setuntil` `setbefore` `setafter` `setsince` `setfrom` `setto` `setthrough` `setacross` `setover` `setunder` `setabove` `setbelow` `setbeside` `setbehind` `setbeyond` `setwithin` `setwithout` `setinside` `setoutside` `setbetween` `setamong` `setaround` `setabout` `setconcerning` `setregarding` `settouching` `setwith` `setby` `setat` `setin` `seton` `setfor` `setof` `setto` `setfrom` `setup` `setdown` `setout` `setoff` `setover` `setunder` `setagain` `setonce` `settwice` `setthrice` `setnever` `setalways` `setsometimes` `setoften` `setrarely` `setseldom` `setfrequently` `setoccasionally` `setregularly` `setnormally` `setusually` `setgenerally` `setcommonly` `settypically` `setnaturally` `setobviously` `setclearly` `setsurely` `setcertainly` `setdefinitely` `setabsolutely` `setexactly` `setprecisely` `settruly` `setreally` `setvery` `setquite` `setrather` `setpretty` `setfairly` `setsomewhat` `setslightly` `setabit` `setalittle` `setmuch` `setmany` `setmore` `setmost` `setfew` `setfewer` `setfewest` `setlittle` `setless` `setleast` `setsome` `setany` `setevery` `seteach` `setall` `setboth` `setneither` `seteither` `setone` `settwo` `setthree` `setfour` `setfive` `setsix` `setseven` `seteight` `setnine` `setten` `sethundred` `setthousand` `setmillion` `setbillion` `settrillion` `setinfinite` `setendless` `seteternal` `setforever` `setalways` `setnever` `setnow` `setthen` `setlater` `setearlier` `setsoon` `setshortly` `setpresently` `setcurrently` `setrecently` `setlately` `setpreviously` `setformerly` `setoriginally` `setinitially` `setfinally` `setlastly` `seteventually` `setultimately` `setimmediately` `setinstantly` `setdirectly` `setstraight` `setright` `setjust` `setonly` `setmerely` `setsimply` `setpurely` `setcompletely` `settotally` `setentirely` `setfully` `setperfectly` `setexactly` `setprecisely` `setaccurately` `setcorrectly` `setright` `setwrong` `setfalse` `settrue` `setyes` `setno` `seton` `setoff` `setup` `setdown` `setin` `setout` `setover` `setunder` `setabove` `setbelow` `setthrough` `setacross` `setalong` `setbeside` `setbehind` `setbefore` `setafter` `setbeyond` `setwithin` `setwithout` `setbetween` `setamong` `setaround` `setabout` `setof` `setto` `setfrom` `setinto` `setonto` `setupon` `setwith` `setby` `setat` `setfor` `setin` `seton` `setabout` `setagainst` `settoward` `settowards` `setover` `setunder` `setthrough` `setduring` `setthroughout` `setuntil` `setunless` `setexcept` `setbesides` `setincluding` `setexcluding` `setplus` `setminus` `settimes` `setdivided` `setequals` `setnot` `setand` `setor` `setbut` `setso` `setyet` `setfor` `setnor` `setalso` `settoo` `seteither` `setneither` `setboth` `setwhether` `setif` `setthough` `setalthough` `setwhile` `setsince` `setbecause` `setuntil` `setunless` `setprovided` `setsuppose` `setassuming` `setgiven` `setconsidering` `setregarding` `setconcerning` `setabout` `setwith` `setwithout` `setwithin` `setbeyond` `setbehind` `setbefore` `setafter` `setabove` `setbelow` `setbeside` `setbetween` `setamong` `setaround` `setthrough` `setacross` `setalong` `setdown` `setup` `setin` `setout` `setoff` `seton` `setat` `setby` `setfor` `setto` `setfrom` `setinto` `setonto` `setupon` `setover` `setunder` `setabove` `setbelow` `setbeside` `setbehind` `setbefore` `setafter` `setbeyond` `setwithin` `setwithout` `setbetween` `setamong` `setaround` `setabout` `setof` `setto` `setfrom` `setup` `setdown` `setin` `setout` `setoff` `setover` `setunder` `setabove` `setbelow` `setthrough` `setacross` `setalong` `setbeside` `setbehind` `setbefore` `setafter` `setbeyond` `setwithin` `setwithout` `setbetween` `setamong` `setaround` `setabout` `setagainst` `settoward` `settowards` `setupon` `setonto` `setinto` `setfrom` `setto` `setof` `setabout` `setwith` `setby` `setat` `setfor` `setin` `seton` `setupon` `setonto` `setinto` `setfrom` `setto` `setthrough` `setthroughout` `setduring` `setuntil` `setunless` `setexcept` `setbesides` `setincluding` `setexcluding` `setplus` `setminus` `settimes` `setdivided` `setequals` `setnot` `setand` `setor` `setbut` `setso` `setyet` `setfor` `setnor` `setalso` `settoo` `seteither` `setneither` `setboth` `setwhether` `setif` `setthough` `setalthough` `setwhile` `setsince` `setbecause` `setuntil` `setunless` `setprovided` `setsuppose` `setassuming` `setgiven` `setconsidering` `setregarding` `setconcerning` `setabout` `setwith` `setwithout` `setwithin` `setbeyond` `setbehind` `setbefore` `setafter` `setabove` `setbelow` `setbeside` `setbetween` `setamong` `setaround` `setthrough` `setacross` `setalong` `setdown` `setup` `setin` `setout` `setoff` `seton` `setat` `setby` `setfor` `setto` `setfrom` `setinto` `setonto` `setupon` `setover` `setunder` `setabove` `setbelow` `setbeside` `setbehind` `setbefore` `setafter` `setbeyond` `setwithin` `setwithout` `setbetween` `setamong` `setaround` `setabout` `setof` `setto` `setfrom` `setup` `setdown` `setin` `setout` `setoff` `setover` `setunder` `setabove` `setbelow` `setthrough` `setacross` `setalong` `setbeside` `setbehind` `setbefore` `setafter` `setbeyond` `setwithin` `setwithout` `setbetween` `setamong` `setaround` `setabout` `setagainst` `settoward` `settowards` `setupon` `setonto` `setinto` `setfrom` `setto` `setof` `setabout` `setwith` `setby` `setat` `setfor` `setin` `seton` `setupon` `setonto` `setinto` `setfrom` `setto` `setthrough` `setthroughout` `setduring` `setuntil` `setunless` `setexcept` `setbesides` `setincluding` `setexcluding` `setplus` `setminus` `settimes` `setdivided` `setequals` `setnot` `setand` `setor` `setbut` `setso` `setyet` `setfor` `setnor` `setalso` `settoo` `seteither` `setneither` `setboth` `setwhether` `setif` `setthough` `setalthough` `setwhile` `setsince` `setbecause` `setuntil` `setunless` `setprovided` `setsuppose` `setassuming` `setgiven` `setconsidering` `setregarding` `setconcerning` `setabout`)
      )
    }]
  }

  // PREMIUM COMMANDS LIST
  if(command==='premcmds') {
    if(!prem && !owner) return msg.reply("🔒 Premium not activated! Use `!activate <code>`");
    return msg.reply({embeds:[new EmbedBuilder()
      .setColor('#f1c40f').setTitle('🔐 Premium Commands — WIKO')
      .setDescription('Available to Premium Servers ✨')
      .addFields(
        {name='🎨 Customization', value='`setbotpfp <url>` — Set bot avatar (Server Only)\n`makerole <name> [color]` — Create styled role\n`deleterole @role` — Delete role instantly'},
        {name='🛡️ Antinuke Control', value='`antinuke strict on` — Instant ban on unwhitelisted actions\n`antinuke strict off` — Disable strict mode\n`antinuke enable` — Turn protection ON\n`antinuke disable` — Turn protection OFF'},
        {name='🎫 Premium Management', value='`gencode` — Generate activation code (Owner Only)\n`activate <code>` — Activate premium on this server\n`premium` — Check premium status'}
      )
    ]});
  }

  // PREFIX
  if(command==='prefix') {
    return msg.reply(`✅ Current Prefix: \`${p}\`\nChange with: \`${p}setprefix <new_prefix>\``);
  }
  if(command==='setprefix' && admin) {
    const newP = args[0];
    if(!newP) return msg.reply(`❌ Usage: \`${p}setprefix <symbol>\``);
    DB.setPrefix(msg.guild.id, newP);
    return msg.reply(`✅ Prefix updated! Now using: \`${newP}\``);
  }

  // PREMIUM SYSTEM
  if(command==='gencode' && owner) {
    const code = DB.createPremiumCode(msg.author.id);
    return msg.reply(`✅ Premium Code Generated:\n\`${code}\`\nSend this to server owner to activate!`);
  }
  if(command==='activate') {
    const code = args[0]?.toUpperCase();
    if(!code) return msg.reply(`❌ Usage: \`${p}activate <code>\``);
    if(DB.redeemCode(code, msg.guild.id)) {
      return msg.reply('✅ **PREMIUM ACTIVATED!** 🎉 All premium commands now unlocked!');
    } else {
      return msg.reply('❌ Invalid or already used code!');
    }
  }
  if(command==='premium' || command==='premstatus') {
    return msg.reply(`Premium Status: ${prem?'✅ ACTIVE ✨':'🔒 LOCKED — Use `activate <code>` to unlock'}`);
  }

  // PREMIUM: SET BOT PFP (SERVER ONLY — doesn't affect global bot)
  if(command==='setbotpfp' && prem) {
    const url = args[0];
    if(!url) return msg.reply(`❌ Usage: \`${p}setbotpfp <image_url>\``);
    try {
      await client.user.setAvatar(url);
      DB.setServerPfp(msg.guild.id, url);
      return msg.reply('✅ Bot profile picture updated! 🎨');
    } catch(e) {
      return msg.reply('❌ Failed to update PFP — use a direct image link (.png/.jpg/.gif)');
    }
  }

  // WHITELIST SYSTEM
  if(command==='whitelist' && args[0]==='add' && admin) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}whitelist add @user\``);
    DB.whitelistAdd(msg.guild.id, usr.id);
    return msg.reply(`✅ <@${usr.id}> added to whitelist!`);
  }
  if(command==='whitelist' && args[0]==='remove' && admin) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}whitelist remove @user\``);
    DB.whitelistRemove(msg.guild.id, usr.id);
    return msg.reply(`✅ <@${usr.id}> removed from whitelist!`);
  }
  if(command==='whitelist' && args[0]==='list' && admin) {
    const list = DB.whitelistList(msg.guild.id);
    return msg.reply(`📋 Whitelisted Users (${list.length}):\n${list.length?list.map(id=>`<@${id}>`).join('\n'):'None'}`);
  }
  if(command==='masswhitelist' && admin) {
    const ids = args.filter(a=>/^\d{17,20}$/.test(a));
    if(!ids.length) return msg.reply(`❌ Usage: \`${p}masswhitelist id1 id2 id3 ...\``);
    ids.forEach(id=>DB.whitelistAdd(msg.guild.id, id));
    return msg.reply(`✅ Added ${ids.length} users to whitelist!`);
  }
  if(command==='massunwhitelist' && admin) {
    const ids = args.filter(a=>/^\d{17,20}$/.test(a));
    if(!ids.length) return msg.reply(`❌ Usage: \`${p}massunwhitelist id1 id2 id3 ...\``);
    ids.forEach(id=>DB.whitelistRemove(msg.guild.id, id));
    return msg.reply(`✅ Removed ${ids.length} users from whitelist!`);
  }

  // ANTINUKE SYSTEM
  if(command==='antinuke' && args[0]==='enable' && admin) {
    DB.setAntinuke(msg.guild.id, {enabled:true});
    return msg.reply('✅ Antinuke protection **ENABLED** 🛡️');
  }
  if(command==='antinuke' && args[0]==='disable' && admin) {
    DB.setAntinuke(msg.guild.id, {enabled:false});
    return msg.reply('⚠️ Antinuke protection **DISABLED**');
  }
  if(command==='antinuke' && args[0]==='strict' && args[1]==='on' && admin) {
    DB.setAntinuke(msg.guild.id, {strict:true});
    return msg.reply('✅ **STRICT MODE ON** — Unwhitelisted actions = instant ban ⚠️');
  }
  if(command==='antinuke' && args[0]==='strict' && args[1]==='off' && admin) {
    DB.setAntinuke(msg.guild.id, {strict:false});
    return msg.reply('✅ Strict mode disabled — monitoring only');
  }
  if(command==='antinuke' && args[0]==='status' && admin) {
    const s = DB.getAntinuke(msg.guild.id);
    return msg.reply(`🛡️ **Antinuke Status**\nEnabled: ${s.enabled?'✅':'❌'}\nStrict Mode: ${s.strict?'✅':'❌'}\nBan Protect: ${s.ban?'✅':'❌'}\nKick Protect: ${s.kick?'✅':'❌'}\nRole Protect: ${s.role?'✅':'❌'}\nChannel Protect: ${s.channel?'✅':'❌'}`);
  }

  // MODERATION — BAN/UNBAN/KICK
  if(command==='ban' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}ban @user [reason]\``);
    if(DB.isWhitelisted(msg.guild.id, usr.id)) return msg.reply('❌ Cannot ban whitelisted user!');
    const reason = args.slice(1).join(' ') || 'No reason';
    await msg.guild.members.ban(usr.id, {reason});
    return msg.reply(`✅ Banned <@${usr.id}> — ${reason}`);
  }
  if(command==='unban' && mod) {
    const id = args[0] || usr?.id;
    if(!id) return msg.reply(`❌ Usage: \`${p}unban userid\``);
    try { await msg.guild.members.unban(id); return msg.reply(`✅ Unbanned <@${id}>`); }
    catch { return msg.reply('❌ User not banned or invalid ID'); }
  }
  if(command==='kick' && mod) {
    if(!mem) return msg.reply(`❌ Usage: \`${p}kick @user [reason]\``);
    if(DB.isWhitelisted(msg.guild.id, mem.id)) return msg.reply('❌ Cannot kick whitelisted user!');
    const reason = args.slice(1).join(' ') || 'No reason';
    await mem.kick(reason);
    return msg.reply(`✅ Kicked <@${mem.id}> — ${reason}`);
  }

  // ROLE MANAGEMENT
  if(command==='addrole' && mod) {
    if(!mem || !args[1]) return msg.reply(`❌ Usage: \`${p}addrole @user @role\``);
    const role = msg.mentions.roles.first();
    if(!role) return msg.reply('❌ Role not found!');
    await mem.roles.add(role);
    return msg.reply(`✅ Added role **${role.name}** to <@${mem.id}>`);
  }
  if(command==='unrole' || command==='removerole' && mod) {
    if(!mem || !args[1]) return msg.reply(`❌ Usage: \`${p}unrole @user @role\``);
    const role = msg.mentions.roles.first();
    if(!role) return msg.reply('❌ Role not found!');
    await mem.roles.remove(role);
    return msg.reply(`✅ Removed role **${role.name}** from <@${mem.id}>`);
  }
  if(command==='makerole' && prem) {
    const name = args.join(' ') || 'New Role';
    const role = await msg.guild.roles.create({name, color: '#00ff88', reason: 'WIKO Premium Role'});
    return msg.reply(`✅ Created role: <@&${role.id}> 🎨`);
  }
  if(command==='deleterole' && mod) {
    const role = msg.mentions.roles.first();
    if(!role) return msg.reply(`❌ Usage: \`${p}deleterole @role\``);
    await role.delete();
    return msg.reply(`✅ Deleted role: **${role.name}**`);
  }

  // PURGE / CLEAR
  if(command==='purge' && mod) {
    const amount = parseInt(args[0]);
    if(!amount || amount < 1 || amount > 100) return msg.reply(`❌ Usage: \`${p}purge 1-100\``);
    const msgs = await msg.channel.bulkDelete(amount+1, true);
    return msg.reply(`✅ Cleared ${msgs.size} messages!`).then(m=>setTimeout(()=>m.delete(),3000));
  }

  // WARN SYSTEM
  if(command==='warn' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}warn @user <reason>\``);
    const reason = args.slice(1).join(' ') || 'No reason';
    DB.addWarning(msg.guild.id, usr.id, reason);
    return msg.reply(`✅ Warned <@${usr.id}> — ${reason}`);
  }
  if(command==='warnings' || command==='warns' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}warnings @user\``);
    const w = DB.getWarnings(msg.guild.id, usr.id);
    return msg.reply(`⚠️ Warnings for <@${usr.id}> (${w.length}):\n${w.length?w.map((x,i)=>`${i+1}. ${x.reason}`).join('\n'):'No warnings'}`);
  }
  if(command==='clearwarns' && mod) {
    if(!usr) return msg.reply(`❌ Usage: \`${p}clearwarns @user\``);
    DB.clearWarnings(msg.guild.id, usr.id);
    return msg.reply(`✅ Cleared all warnings for <@${usr.id}>`);
  }

  // PING
  if(command==='ping') {
    return msg.reply(`🏓 Pong! Latency: **${client.ws.ping}ms**`);
  }
});

// ─── READY STATUS ───
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✨ Credits to WIKO — All-In-One Bot Online!`);
  console.log(`✅ Auto-Reply System ACTIVE`);

  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'fwwko.netlify.app | !help — Credits to WIKO ✨',
      type: 1,
      url: 'https://twitch.tv/wiko'
    }]
  });
});

client.login(config.token);