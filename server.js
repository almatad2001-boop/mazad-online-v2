const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const app=express();
const server=http.createServer(app);const io=new Server(server);
app.use(express.static(path.join(__dirname,'public')));

const rooms=new Map();
const COLORS=['#0f766e','#7c3aed','#b45309','#2563eb','#be123c','#15803d','#a21caf','#475569','#ca8a04','#0f766e','#7c2d12','#1d4ed8','#0e7490','#9333ea','#c2410c','#166534'];
// Middle East strategic territories — simplified real-country map for conquest gameplay.
const TERRITORIES=[
 {id:0,name:'تركيا',en:'Turkey',capital:'أنقرة'},
 {id:1,name:'سوريا',en:'Syria',capital:'دمشق'},
 {id:2,name:'لبنان',en:'Lebanon',capital:'بيروت'},
 {id:3,name:'فلسطين',en:'Palestine',capital:'القدس'},
 {id:4,name:'الأردن',en:'Jordan',capital:'عمّان'},
 {id:5,name:'العراق',en:'Iraq',capital:'بغداد'},
 {id:6,name:'إيران',en:'Iran',capital:'طهران'},
 {id:7,name:'الكويت',en:'Kuwait',capital:'مدينة الكويت'},
 {id:8,name:'السعودية',en:'Saudi Arabia',capital:'الرياض'},
 {id:9,name:'البحرين',en:'Bahrain',capital:'المنامة'},
 {id:10,name:'قطر',en:'Qatar',capital:'الدوحة'},
 {id:11,name:'الإمارات',en:'United Arab Emirates',capital:'أبوظبي'},
 {id:12,name:'عُمان',en:'Oman',capital:'مسقط'},
 {id:13,name:'اليمن',en:'Yemen',capital:'صنعاء'},
 {id:14,name:'مصر',en:'Egypt',capital:'القاهرة'},
 {id:15,name:'إسرائيل',en:'Israel',capital:'القدس'},
 {id:16,name:'أفغانستان',en:'Afghanistan',capital:'كابول'},
 {id:17,name:'باكستان',en:'Pakistan',capital:'إسلام آباد'},
 {id:18,name:'ليبيا',en:'Libya',capital:'طرابلس'}
];
const ADJ={
 0:[1,5,6],
 1:[0,2,3,4,5,15],
 2:[1,3,15],
 3:[1,2,4,14,15],
 4:[1,3,5,8,15],
 5:[0,1,4,6,7,8],
 6:[0,5,7,11],
 7:[5,8,9],
 8:[4,5,7,9,10,11,12,13],
 9:[7,10,8],
 10:[9,8,11],
 11:[6,8,10,12],
 12:[8,11,13],
 13:[8,12,14],
 14:[3,13,15],
 15:[1,2,3,4,14],
 16:[6,17],
 17:[6,16],
 18:[14]
};
function rid(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function clean(n){return String(n||'ملك').trim().slice(0,18)||'ملك'}
function freshRegions(){return TERRITORIES.map((g,i)=>({id:i,name:g.name,en:g.en,capital:g.capital,areas:[],owner:null,army:100,level:1,income:60,defense:30,militia:null,securityInvestigations:{}}))}
function player(socket,name){return {id:socket.id,name:clean(name),gold:500,army:0,score:0,alive:true,color:null,allies:[],leader:'الملك',territories:[],actionsLeft:2}}
function regionCount(r,pid){return r.regions.filter(x=>x.owner===pid).length}
function syncPlayer(r,p){p.territories=r.regions.filter(x=>x.owner===p.id).map(x=>x.id);p.army=p.territories.reduce((s,i)=>s+r.regions[i].army,0);p.allies=r.players.filter(q=>q.id!==p.id&&relation(r,p.id,q.id)==='alliance').map(q=>q.id);p.score=regionCount(r,p.id)*500+p.gold+p.army*0.5+r.regions.filter(x=>x.owner===p.id).reduce((s,x)=>s+x.level*80,0)}
function pub(r,viewerId){r.players.forEach(p=>syncPlayer(r,p));const regions=r.regions.map(x=>{const y={...x};const own=x.owner===viewerId;const detected=viewerId&&x.securityInvestigations?.[viewerId];delete y.securityInvestigations;y.securityReady=!!detected;if(x.militia&&!own&&!detected){y.militia=x.militia.active?{active:true}:null}else if(x.militia){y.militia={owner:x.militia.owner,count:x.militia.count,active:x.militia.active,detected:true,intervention:x.militia.intervention||false}}return y});return {code:r.code,host:r.host,started:r.started,phase:r.phase,round:r.round,maxRounds:r.maxRounds,maxPlayers:TERRITORIES.length,turnPlayer:r.players[r.turn]?.id||null,actionsLeft:r.players[r.turn]?.actionsLeft||0,event:'',eventDesc:'',regions,players:r.players.map(p=>({id:p.id,name:p.name,gold:p.gold,army:p.army,score:Math.round(p.score),alive:p.alive,color:p.color,allies:p.allies,leader:p.leader,territories:p.territories,actionsLeft:p.actionsLeft})),log:r.log.slice(-30),winner:r.winner||null,myDiplomacy:r.players.map(p=>({id:p.id,relations:relationView(r,p.id),pending:pendingFor(r,p.id)}))}}
function send(r){r.players.forEach(p=>io.to(p.id).emit('state',pub(r,p.id)))}
function log(r,s){r.log.push(s);if(r.log.length>80)r.log.shift()}
function current(r){return r.players[r.turn]}
function nextTurn(r){for(let n=1;n<=r.players.length;n++){let i=(r.turn+n)%r.players.length;if(r.players[i]?.alive){r.turn=i;return}}}
function alivePlayers(r){return r.players.filter(p=>p.alive)}
function pairKey(a,b){return [a,b].sort().join('|')}
function relation(r,a,b){if(!a||!b||a===b)return 'self';const d=r.diplomacy[pairKey(a,b)];if(!d)return 'none';if(d.status==='war')return 'war';if(d.expiresRound && r.round>d.expiresRound){delete r.diplomacy[pairKey(a,b)];return 'none'}return d.status}
function setRelation(r,a,b,status,expiresRound=null){r.diplomacy[pairKey(a,b)]={status,expiresRound}}
function pendingFor(r,pid){return r.requests.filter(x=>x.to===pid)}
function relationView(r,pid){const out={};r.players.forEach(x=>{if(x.id!==pid)out[x.id]=relation(r,pid,x.id)});return out}
function assign(r){
 const order=[8,0,6,14,5,1,12,11,7,4,3,15,2,9,10,13,16,17,18];
 r.players.forEach((p,idx)=>{p.color=COLORS[idx%COLORS.length];const a=order[idx];r.regions[a].owner=p.id;r.regions[a].army=140;r.regions[a].defense=45;p.gold=500;p.actionsLeft=2});
}
function start(r){r.started=true;r.phase='playing';r.round=1;r.turn=0;assign(r);log(r,`👑 بدأت اللعبة. ${r.players[0].name} يبدأ أولاً.`);log(r,'💡 في دورك لديك حركتان. الدخل يُضاف تلقائياً.');beginTurn(r)}
function beginTurn(r){const p=current(r);if(!p)return;p.actionsLeft=2;const income=r.regions.filter(x=>x.owner===p.id).reduce((s,x)=>s+x.income,0);p.gold+=income;log(r,`💰 ${p.name} استلم ${income} ذهب تلقائياً من دوله.`);send(r)}
function applyMilitiaRound(r){r.regions.forEach(t=>{const m=t.militia;if(!m||!m.active||!m.owner)return;const loss=m.count>=50?40:m.count>=40?30:m.count>=30?20:m.count>=20?10:m.count>=10?5:0;if(loss>0){t.defense=Math.max(0,t.defense-loss);log(r,`🔥 تمرد ${t.name}: خلية ${m.count} ميليشيا خفّضت الدفاع ${loss}.`);}})}
function endTurn(r){nextTurn(r);if(r.turn===0){r.round++;applyMilitiaRound(r)}if(r.round>r.maxRounds){finish(r);return}beginTurn(r)}
function finish(r){r.phase='finished';r.started=false;r.players.forEach(p=>syncPlayer(r,p));r.players.sort((a,b)=>b.score-a.score);r.winner=r.players[0]?.id;log(r,`👑 انتهت اللعبة. الفائز: ${r.players[0]?.name||'—'}`);send(r)}
function validTurn(r,socketId){return r.started&&current(r)?.id===socketId}
function spendAction(p){p.actionsLeft=Math.max(0,p.actionsLeft-1)}
function attack(r,p,targetId){
 let t=r.regions[targetId]; if(!t)return 'الدولة غير موجودة'; if(t.owner===p.id)return 'هذه دولتك بالفعل';
 const source=r.regions.find(x=>x.owner===p.id&&ADJ[x.id]?.includes(t.id)&&x.army>=50);
 if(!source)return 'هذه الدولة ليست مجاورة لك أو لا يوجد جيش كافٍ للهجوم.';
 const cost=100;if(p.gold<cost)return 'تحتاج 100 ذهب للهجوم';
 p.gold-=cost;p.stats=p.stats||{attacks:0};p.stats.attacks++;
 const power=source.army*.72+source.level*20+Math.random()*30;
 const defense=t.army*.62+t.defense+t.level*15+Math.random()*25;
 if(power>defense){const loss=Math.max(20,Math.floor(source.army*.25));source.army-=loss;t.owner=p.id;t.army=Math.max(55,Math.floor(source.army*.55));t.level=1;t.defense=30;log(r,`⚔️ ${p.name} احتل ${t.name} بنجاح!`);return `🏆 احتللت ${t.name}`}
 source.army=Math.max(20,source.army-Math.floor(source.army*.2));t.army=Math.max(15,t.army-Math.floor(t.army*.1));return `🛡️ فشل الهجوم على ${t.name}`
}
function diplomacyRequest(r,p,toId,type){
 const q=r.players.find(x=>x.id===toId); if(!q)return 'اللاعب غير موجود';
 if(toId===p.id)return 'لا يمكنك إرسال طلب لنفسك.';
 const rel=relation(r,p.id,toId); if(rel==='war')return 'بينكما حرب أبدية ولا يمكن إرسال طلب سياسي.';
 if(rel==='alliance'||rel==='truce')return 'بينكما اتفاق قائم بالفعل.';
 if(r.requests.some(x=>x.from===p.id&&x.to===toId))return 'لديك طلب قائم لهذا اللاعب.';
 const id=++r.requestSeq;r.requests.push({id,from:p.id,to:toId,type});
 log(r,`📜 ${p.name} أرسل طلب ${type==='alliance'?'تحالف':'هدنة'} إلى ${q.name}.`);return `📨 أرسلت طلب ${type==='alliance'?'تحالف':'هدنة'} إلى ${q.name}.`;
}
function diplomacyResponse(r,p,requestId,choice){
 const req=r.requests.find(x=>x.id===requestId&&x.to===p.id);if(!req)return 'الطلب غير موجود أو انتهت صلاحيته.';
 const from=r.players.find(x=>x.id===req.from);r.requests=r.requests.filter(x=>x.id!==requestId);if(!from)return 'اللاعب غير موجود.';
 if(choice==='accept'){const rounds=req.type==='alliance'?5:3;setRelation(r,p.id,from.id,req.type,r.round+rounds);log(r,`🤝 ${p.name} قبل ${req.type==='alliance'?'تحالف':'هدنة'} ${from.name} لمدة ${rounds} جولات.`);return `✅ تم قبول ${req.type==='alliance'?'التحالف':'الهدنة'} مع ${from.name}.`}
 if(choice==='kill'){setRelation(r,p.id,from.id,'war');log(r,`☠️ ${p.name} قتل رسول ${from.name}. بينهما حرب أبدية.`);return `☠️ قتلت الرسول. بدأت حرب أبدية مع ${from.name}.`}
 log(r,`❌ ${p.name} رفض طلب ${req.type==='alliance'?'تحالف':'هدنة'} من ${from.name}.`);return `❌ تم رفض الطلب من ${from.name}.`;
}
function support(r,p,type,sourceId,targetId,amount){
 const rel=relation(r,p.id,r.regions[targetId]?.owner);if(rel!=='alliance')return 'يمكن إرسال الإسناد إلى حليف نشط فقط.';
 const source=r.regions[sourceId],target=r.regions[targetId];if(!source||source.owner!==p.id)return 'اختر دولة تملكها كمصدر للإسناد.';if(!target||!target.owner||target.owner===p.id)return 'اختر دولة يملكها حليفك.';
 const n=Math.floor(Number(amount));if(!Number.isFinite(n)||n<1)return 'أدخل كمية صحيحة.';
 if(n>Math.floor(source.army/2))return 'لا يمكنك إرسال أكثر من نصف جيش الدولة في الإسناد.';
 if(type==='army'){source.army-=n;target.army+=n}else if(type==='defense'){if(n>Math.floor(source.defense/2))return 'لا يمكنك إرسال أكثر من نصف دفاع الدولة.';source.defense-=n;target.defense+=n}else return 'نوع الإسناد غير صحيح.';
 spendAction(p);const receiver=r.players.find(x=>x.id===target.owner);log(r,`🤝 ${p.name} أرسل ${n} ${type==='army'?'جيش':'دفاع'} من ${source.name} إلى حليفه ${receiver?.name||'حليف'}.`);return `🤝 تم إرسال ${n} ${type==='army'?'جيش':'دفاع'} إلى ${target.name}.`;
}

function neighborsOwnedBy(r,pid,targetId){return r.regions.some(x=>x.owner===pid&&ADJ[x.id]?.includes(targetId))}
function plantMilitia(r,p,targetId){const t=r.regions[targetId];if(!t||t.owner===p.id||!t.owner)return 'اختر دولة يملكها خصم ومجاورة لإحدى دولك.';if(!neighborsOwnedBy(r,p.id,targetId))return 'يمكن زرع الميليشيات في دولة مجاورة فقط.';if(p.gold<30)return 'تحتاج 30 ذهب لزرع 10 ميليشيات.';const m=t.militia;if(m&&m.owner!==p.id)return 'هناك خلية ميليشيا تابعة للاعب آخر.';const count=(m?.count||0)+10;if(count>50)return 'الحد الأقصى 50 ميليشيا في الدولة.';p.gold-=30;t.militia={owner:p.id,count,active:m?.active||false,intervention:false};spendAction(p);return `🕵️ زرعت 10 ميليشيات في ${t.name}. الإجمالي: ${count}.`}
function startRevolt(r,p,targetId){const t=r.regions[targetId],m=t?.militia;if(!t||!m||m.owner!==p.id)return 'لا توجد خلية ميليشيات لك في هذه الدولة.';if(m.active)return 'التمرد بدأ بالفعل.';m.active=true;spendAction(p);log(r,`🔥 ${p.name} فعّل تمردًا داخل ${t.name} (${m.count} ميليشيا).`);return `🔥 بدأ التمرد داخل ${t.name}. سيبدأ خفض الدفاع مع نهاية كل جولة.`}
function intelligence(r,p,targetId){const t=r.regions[targetId];if(!t||t.owner===p.id)return 'اختر دولة خصم.';if(!neighborsOwnedBy(r,p.id,targetId))return 'الاستخبارات متاحة للدول المجاورة فقط.';spendAction(p);const m=t.militia;const count=m?.count||0;const probability=count>=50?90:count>=40?75:count>=30?55:count>=20?35:count>=10?15:5;t.securityInvestigations=t.securityInvestigations||{};t.securityInvestigations[p.id]=true;return `🔍 الاستخبارات: احتمال وجود ميليشيات في ${t.name} هو ${probability}%. ${count?'تم رصد مؤشرات تتوافق مع خلية نائمة.':'لا توجد مؤشرات قوية حاليًا.'} خيار تدخل أمن الدولة أصبح متاحًا.`}
function securityIntervention(r,p,targetId){const t=r.regions[targetId];if(!t||t.owner===p.id)return 'اختر دولة خصم.';if(!t.securityInvestigations?.[p.id])return 'استخدم الاستخبارات أولًا.';if(p.gold<80)return 'تحتاج 80 ذهب لتدخل أمن الدولة.';p.gold-=80;spendAction(p);if(t.militia&&t.militia.active){log(r,`🚨 ${p.name} نفّذ تدخل أمن الدولة في ${t.name} وأحبط التمرد.`);t.militia=null;return `🚨 تم تطهير ${t.name} من الميليشيات.`}return 'لم يتم العثور على ميليشيات.'}

function action(r,p,type,targetId,destinationId,amount,supportType){
 if(type==='end'){endTurn(r);return null}
 if(p.actionsLeft<=0)return 'انتهت حركاتك. اضغط إنهاء الدور.';
 if(type==='support'){return support(r,p,supportType,targetId,destinationId,amount)}
 if(type==='plantMilitia')return plantMilitia(r,p,targetId);
 if(type==='revolt')return startRevolt(r,p,targetId);
 if(type==='intelligence')return intelligence(r,p,targetId);
 if(type==='securityIntervention')return securityIntervention(r,p,targetId);
 if(type==='withdraw'){
   const source=r.regions[targetId], dest=r.regions[destinationId];
   if(!source||source.owner!==p.id)return 'اختر دولة تملكها كمصدر للجيش.';
   if(!dest||dest.owner!==p.id)return 'اختر دولة تملكها لنقل الجيش إليها.';
   if(source.id===dest.id)return 'اختر دولة مختلفة لنقل الجيش إليها.';
   if(source.army<=0)return 'هذه الدولة لا تملك جيشًا لنقله.';
   const moved=source.army; source.army=0; dest.army+=moved; spendAction(p);
   log(r,`🔄 ${p.name} سحب جيش ${source.name} بالكامل (${moved}) ونقله إلى ${dest.name}.`);
   return `🔄 تم نقل ${moved} جيش من ${source.name} إلى ${dest.name}. بقيت ${source.name} تحت سيطرتك بدون جيش.`;
 }
 if(type==='attack'){const msg=attack(r,p,targetId);if(!msg.startsWith('هذه')&&!msg.startsWith('تحتاج')&&!msg.startsWith('هذه الدولة'))spendAction(p);return msg}
 if(type==='recruit'){const own=r.regions.find(x=>x.owner===p.id);if(!own)return 'لا تملك دولة';if(p.gold<50)return 'تحتاج 50 ذهب';p.gold-=50;own.army+=50;spendAction(p);return `🪖 +50 جيش في ${own.name}`}
 if(type==='fortify'){const t=r.regions[targetId];if(!t||t.owner!==p.id)return 'اختر دولة تملكها';if(p.gold<50)return 'تحتاج 50 ذهب';p.gold-=50;t.defense+=25;spendAction(p);return `🛡️ +25 دفاع لـ ${t.name}`}
 if(type==='build'){const t=r.regions[targetId];if(!t||t.owner!==p.id)return 'اختر دولة تملكها';if(p.gold<80)return 'تحتاج 80 ذهب';if(t.level>=5)return 'هذه الدولة وصلت للمستوى 5';p.gold-=80;t.level++;t.income+=15;t.defense+=10;spendAction(p);return `🏗️ طورت ${t.name} — الدخل الآن ${t.income}`}
 return 'اختر احتلال أو تجنيد أو تحصين أو تطوير أو نقل الجيش أو الميليشيات.'
}

io.on('connection',socket=>{
 socket.on('createRoom',({name,maxRounds=20},cb)=>{let code=rid();while(rooms.has(code))code=rid();let r={code,host:socket.id,players:[],regions:freshRegions(),started:false,phase:'lobby',round:0,maxRounds:Math.max(5,Math.min(50,+maxRounds||20)),turn:0,event:null,log:[],winner:null,diplomacy:{},requests:[],requestSeq:0};rooms.set(code,r);r.players.push(player(socket,name));socket.join(code);cb?.({ok:true,code});send(r)});
 socket.on('joinRoom',({code,name},cb)=>{let r=rooms.get(String(code||'').toUpperCase());if(!r)return cb?.({ok:false,error:'الغرفة غير موجودة'});if(r.started)return cb?.({ok:false,error:'اللعبة بدأت'});if(r.players.length>=TERRITORIES.length)return cb?.({ok:false,error:`الغرفة مكتملة — الحد الأقصى ${TERRITORIES.length} لاعبًا`});r.players.push(player(socket,name));socket.join(r.code);log(r,`👤 انضم ${r.players.at(-1).name}`);cb?.({ok:true,code:r.code});send(r)});
 socket.on('start',({code},cb)=>{let r=rooms.get(code);if(!r||r.host!==socket.id)return cb?.({ok:false,error:'المضيف فقط'});if(r.players.length<2)return cb?.({ok:false,error:'تحتاج لاعبين اثنين على الأقل'});start(r);cb?.({ok:true})});
 socket.on('action',({code,type,targetId,destinationId,amount,supportType},cb)=>{let r=rooms.get(code);if(!validTurn(r,socket.id))return cb?.({ok:false,error:'ليس دورك'});let p=current(r);let result=action(r,p,type,targetId,destinationId,amount,supportType);if(result)log(r,`${p.name}: ${result}`);send(r);cb?.({ok:true,message:result})});
socket.on('diplomacyRequest',({code,toId,type},cb)=>{let r=rooms.get(code);if(!r||!r.started)return cb?.({ok:false,error:'اللعبة غير متاحة'});let p=r.players.find(x=>x.id===socket.id);let result=diplomacyRequest(r,p,toId,type);send(r);cb?.({ok:true,message:result})});
socket.on('diplomacyResponse',({code,requestId,choice},cb)=>{let r=rooms.get(code);if(!r||!r.started)return cb?.({ok:false,error:'اللعبة غير متاحة'});let p=r.players.find(x=>x.id===socket.id);let result=diplomacyResponse(r,p,requestId,choice);send(r);cb?.({ok:true,message:result})});
 socket.on('disconnect',()=>{for(const r of rooms.values()){let p=r.players.find(x=>x.id===socket.id);if(!p)continue;if(!r.started){r.players=r.players.filter(x=>x.id!==socket.id);if(r.host===socket.id)r.host=r.players[0]?.id||null;if(!r.players.length)rooms.delete(r.code);else send(r)}else{p.alive=false;log(r,`🚪 غادر ${p.name}`);if(current(r)?.id===p.id)endTurn(r);else send(r)}}});
});
app.get('/health',(req,res)=>res.json({ok:true,rooms:rooms.size}));
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log('Malik Al Mamlaka Pro live on '+PORT));
