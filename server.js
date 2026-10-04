const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const {createClient}=require('@supabase/supabase-js');
const app=express(); const server=http.createServer(app); const io=new Server(server);
app.use(express.json({limit:'32kb'}));
const SUPABASE_URL=process.env.SUPABASE_URL||'';
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const supabase=(SUPABASE_URL&&SUPABASE_SERVICE_ROLE_KEY)?createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}):null;
function parseCookies(header=''){return Object.fromEntries(header.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [decodeURIComponent(i<0?x:x.slice(0,i)),decodeURIComponent(i<0?'':x.slice(i+1))]}));}
function tokenHash(t){return crypto.createHash('sha256').update(t).digest('hex');}
function setSession(res,token){res.setHeader('Set-Cookie',`mazad_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);}
function clearSession(res){res.setHeader('Set-Cookie','mazad_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'+(process.env.NODE_ENV==='production'?'; Secure':''));}
async function userFromRequest(req){if(!supabase)return null;const token=parseCookies(req.headers.cookie||'').mazad_session;if(!token)return null;const {data,error}=await supabase.from('sessions').select('user_id,expires_at,users(id,username,created_at)').eq('token_hash',tokenHash(token)).maybeSingle();if(error||!data||new Date(data.expires_at)<=new Date())return null;return data.users;}
async function createSession(userId,res){const token=crypto.randomBytes(32).toString('hex');const expires=new Date(Date.now()+30*24*60*60*1000).toISOString();const {error}=await supabase.from('sessions').insert({user_id:userId,token_hash:tokenHash(token),expires_at:expires});if(error)throw error;setSession(res,token);}
function authReady(res){if(!supabase){res.status(503).json({ok:false,error:'نظام الحسابات غير مُعد بعد. أضف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في Render.'});return false}return true;}
app.get('/api/health',async(req,res)=>res.json({ok:true,accounts:!!supabase}));
app.post('/api/auth/register',async(req,res)=>{try{if(!authReady(res))return;const username=String(req.body?.username||'').trim();const password=String(req.body?.password||'');if(!/^[-_ \p{L}\p{N}]{3,20}$/u.test(username))return res.status(400).json({ok:false,error:'اسم المستخدم يجب أن يكون من 3 إلى 20 حرفًا أو رقمًا.'});if(password.length<6)return res.status(400).json({ok:false,error:'كلمة المرور يجب أن تكون 6 أحرف على الأقل.'});const {data:existing,error:findErr}=await supabase.from('users').select('id').eq('username',username).maybeSingle();if(findErr)throw findErr;if(existing)return res.status(409).json({ok:false,error:'اسم المستخدم مستخدم بالفعل.'});const password_hash=await bcrypt.hash(password,12);const {data:user,error}=await supabase.from('users').insert({username,password_hash}).select('id,username,created_at').single();if(error)throw error;await createSession(user.id,res);res.json({ok:true,user});}catch(e){console.error(e);res.status(500).json({ok:false,error:'تعذر إنشاء الحساب الآن.'});}});
app.post('/api/auth/login',async(req,res)=>{try{if(!authReady(res))return;const username=String(req.body?.username||'').trim();const password=String(req.body?.password||'');const {data:user,error}=await supabase.from('users').select('id,username,password_hash,created_at').eq('username',username).maybeSingle();if(error)throw error;if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({ok:false,error:'اسم المستخدم أو كلمة المرور غير صحيحة.'});await createSession(user.id,res);delete user.password_hash;res.json({ok:true,user});}catch(e){console.error(e);res.status(500).json({ok:false,error:'تعذر تسجيل الدخول الآن.'});}});
app.get('/api/auth/me',async(req,res)=>{try{if(!authReady(res))return;const user=await userFromRequest(req);if(!user)return res.status(401).json({ok:false});res.json({ok:true,user});}catch(e){res.status(500).json({ok:false,error:'تعذر قراءة الحساب.'});}});
app.post('/api/auth/logout',async(req,res)=>{try{if(supabase){const token=parseCookies(req.headers.cookie||'').mazad_session;if(token)await supabase.from('sessions').delete().eq('token_hash',tokenHash(token));}clearSession(res);res.json({ok:true});}catch(e){clearSession(res);res.json({ok:true});}});
app.get('/api/profile',async(req,res)=>{try{if(!authReady(res))return;const user=await userFromRequest(req);if(!user)return res.status(401).json({ok:false,error:'سجل الدخول أولًا.'});const {data:results,error}=await supabase.from('game_results').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);if(error)throw error;const games=results||[];const wins=games.filter(x=>x.rank===1).length;const totalSpent=games.reduce((a,x)=>a+Number(x.spent||0),0);const avgScore=games.length?games.reduce((a,x)=>a+Number(x.total_score||0),0)/games.length:0;res.json({ok:true,user,stats:{games:games.length,wins,second:games.filter(x=>x.rank===2).length,third:games.filter(x=>x.rank===3).length,totalSpent:Number(totalSpent.toFixed(1)),avgScore:Number(avgScore.toFixed(1))},results:games});}catch(e){console.error(e);res.status(500).json({ok:false,error:'تعذر تحميل ملفك.'});}});
app.use(express.static(path.join(__dirname,'public')));
const films=[
['The Dark Knight',2008,9.0,100,'جريمة • دراما','نادر','rare','https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg'],
['Inception',2010,8.8,92,'خيال علمي • إثارة','مميز','special','https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg'],
['Interstellar',2014,8.7,88,'خيال علمي • دراما','مميز','special','https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg'],
['The Godfather',1972,9.2,120,'جريمة • دراما','أسطوري','legendary','https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg'],
['Fight Club',1999,8.8,84,'دراما • إثارة','مميز','special','https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg'],
['Forrest Gump',1994,8.8,90,'دراما • رومانسية','نادر','rare','https://image.tmdb.org/t/p/w500/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg'],
['Gladiator',2000,8.5,78,'ملحمي • أكشن','عادي','common','https://image.tmdb.org/t/p/w500/ty8TnY2K0rQxazBM5J7x5Jw9b1L.jpg'],
['The Matrix',1999,8.7,86,'خيال علمي • أكشن','نادر','rare','https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg']
].map(x=>({name:x[0],year:x[1],rating:x[2],baseValue:x[3],genre:x[4],rarity:x[5],rarityClass:x[6],img:x[7]}));
// إضافة أكثر من 100 فيلم إضافي
const extraTitles = [
'Pulp Fiction','The Shawshank Redemption','The Lord of the Rings: The Return of the King',
'The Lord of the Rings: The Fellowship of the Ring','The Lord of the Rings: The Two Towers',
'The Dark Knight Rises','The Prestige','Django Unchained','The Departed','Whiplash',
'Parasite','Joker','Avengers: Endgame','Avengers: Infinity War','Iron Man',
'Captain America: The Winter Soldier','Guardians of the Galaxy','Thor: Ragnarok',
'Spider-Man: No Way Home','Spider-Man: Into the Spider-Verse','Logan','Deadpool',
'Deadpool 2','Black Panther','Doctor Strange','The Batman','Batman Begins',
'Man of Steel','Wonder Woman','Aquaman','Mission: Impossible - Fallout',
'Mission: Impossible - Dead Reckoning','Top Gun: Maverick','John Wick',
'John Wick: Chapter 2','John Wick: Chapter 3','John Wick: Chapter 4',
'Mad Max: Fury Road','Furiosa','The Revenant','Dune','Dune: Part Two',
'Blade Runner 2049','Arrival','Alien','Aliens','Terminator 2: Judgment Day',
'Terminator','Jurassic Park','Jurassic World','Jaws','Titanic',
'Avatar','Avatar: The Way of Water','The Wolf of Wall Street','Goodfellas',
'Casino','Scarface','Heat','Se7en','Zodiac','Gone Girl','Prisoners',
'No Country for Old Men','There Will Be Blood','The Green Mile',
'Saving Private Ryan','Schindler’s List','Gladiator II','Braveheart',
'300','Troy','Kingdom of Heaven','The Last Samurai','Apocalypto',
'Pirates of the Caribbean: The Curse of the Black Pearl','Pirates of the Caribbean: Dead Man’s Chest',
'The Hunger Games','Harry Potter and the Philosopher’s Stone',
'Harry Potter and the Deathly Hallows: Part 2','Fantastic Beasts',
'The Lion King','Toy Story','Toy Story 3','Up','WALL-E','Coco',
'Finding Nemo','Ratatouille','Inside Out','Inside Out 2','Shrek',
'Shrek 2','Kung Fu Panda','How to Train Your Dragon','The Incredibles',
'The Incredibles 2','Monsters, Inc.','Spider-Man','Spider-Man 2',
'Spider-Man 3','The Amazing Spider-Man','The Amazing Spider-Man 2',
'The Sixth Sense','A Beautiful Mind','The Social Network','Oppenheimer',
'Barbie','La La Land','The Truman Show','Eternal Sunshine of the Spotless Mind',
'The Grand Budapest Hotel','Her','Drive','Nightcrawler','Black Swan',
'The Silence of the Lambs','American Psycho','Memento','Oldboy',
'City of God','Amélie','Cinema Paradiso','The Pianist','1917',
'All Quiet on the Western Front','Ford v Ferrari','Moneyball','Rocky',
'Creed','Warrior','The Fighter','The Karate Kid','The Blind Side'
];

extraTitles.forEach((name,i)=>{
  const year=1980+(i%45);
  const rating=Math.round((7.2+(i%18)*0.1)*10)/10;
  const baseValue=40+((i*10)%91)*10;
  const fame=70+(i%31);
  const awards=i%9;
  films.push({
    id:'extra-'+i,
    name,
    year,
    rating,
    baseValue,
    genre:'فيلم',
    rarity:rating>=8.5?'نادر':rating>=8?'مميز':'عادي',
    rarityClass:rating>=8.5?'rare':rating>=8?'special':'common',
    img:''
  });
});

// إعطاء ID ثابت للأفلام الأصلية أيضًا
films.forEach((f,i)=>{
  if(!f.id) f.id='film-'+i;
});
const cinema={'The Dark Knight':{fame:99,awards:3,awardText:'فاز بأوسكار + 8 ترشيحات'},'Inception':{fame:97,awards:5,awardText:'4 أوسكارات + 8 ترشيحات'},'Interstellar':{fame:96,awards:1,awardText:'أوسكار + 5 ترشيحات'},'The Godfather':{fame:100,awards:6,awardText:'3 أوسكارات + 7 ترشيحات'},'Fight Club':{fame:94,awards:0,awardText:'ترشيحات وجوائز نقدية دون أوسكار'},'Forrest Gump':{fame:99,awards:8,awardText:'6 أوسكارات + 13 ترشيحًا'},'Gladiator':{fame:98,awards:6,awardText:'5 أوسكارات + 12 ترشيحًا'},'The Matrix':{fame:99,awards:5,awardText:'4 أوسكارات + جوائز تقنية متعددة'}};
const celebrities = [
  {id:'actor-0',name:"Leonardo DiCaprio",year:2026,rating:7.2,baseValue:40,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:72,awards:0},
  {id:'actor-1',name:"Tom Hanks",year:2026,rating:7.3,baseValue:140,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:73,awards:1},
  {id:'actor-2',name:"Brad Pitt",year:2026,rating:7.4,baseValue:240,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:74,awards:2},
  {id:'actor-3',name:"Johnny Depp",year:2026,rating:7.5,baseValue:340,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:75,awards:3},
  {id:'actor-4',name:"Robert De Niro",year:2026,rating:7.6,baseValue:440,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:76,awards:4},
  {id:'actor-5',name:"Al Pacino",year:2026,rating:7.7,baseValue:540,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:77,awards:5},
  {id:'actor-6',name:"Denzel Washington",year:2026,rating:7.8,baseValue:640,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:78,awards:6},
  {id:'actor-7',name:"Morgan Freeman",year:2026,rating:7.9,baseValue:740,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:79,awards:7},
  {id:'actor-8',name:"Keanu Reeves",year:2026,rating:8.0,baseValue:840,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:80,awards:8},
  {id:'actor-9',name:"Christian Bale",year:2026,rating:8.1,baseValue:940,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:81,awards:9},
  {id:'actor-10',name:"Will Smith",year:2026,rating:8.2,baseValue:130,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:82,awards:0},
  {id:'actor-11',name:"Tom Cruise",year:2026,rating:8.3,baseValue:230,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:83,awards:1},
  {id:'actor-12',name:"Matt Damon",year:2026,rating:8.4,baseValue:330,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:84,awards:2},
  {id:'actor-13',name:"Ryan Gosling",year:2026,rating:8.5,baseValue:430,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:85,awards:3},
  {id:'actor-14',name:"Ryan Reynolds",year:2026,rating:8.6,baseValue:530,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:86,awards:4},
  {id:'actor-15',name:"Hugh Jackman",year:2026,rating:8.7,baseValue:630,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:87,awards:5},
  {id:'actor-16',name:"Arnold Schwarzenegger",year:2026,rating:8.8,baseValue:730,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:88,awards:6},
  {id:'actor-17',name:"Sylvester Stallone",year:2026,rating:8.9,baseValue:830,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:89,awards:7},
  {id:'actor-18',name:"Jason Statham",year:2026,rating:7.2,baseValue:930,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:90,awards:8},
  {id:'actor-19',name:"Jackie Chan",year:2026,rating:7.3,baseValue:120,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:91,awards:9},
  {id:'actor-20',name:"Jet Li",year:2026,rating:7.4,baseValue:220,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:92,awards:0},
  {id:'actor-21',name:"Bruce Willis",year:2026,rating:7.5,baseValue:320,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:93,awards:1},
  {id:'actor-22',name:"Jim Carrey",year:2026,rating:7.6,baseValue:420,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:94,awards:2},
  {id:'actor-23',name:"Adam Sandler",year:2026,rating:7.7,baseValue:520,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:95,awards:3},
  {id:'actor-24',name:"Chris Hemsworth",year:2026,rating:7.8,baseValue:620,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:96,awards:4},
  {id:'actor-25',name:"Chris Evans",year:2026,rating:7.9,baseValue:720,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:97,awards:5},
  {id:'actor-26',name:"Chris Pratt",year:2026,rating:8.0,baseValue:820,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:98,awards:6},
  {id:'actor-27',name:"Mark Ruffalo",year:2026,rating:8.1,baseValue:920,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:99,awards:7},
  {id:'actor-28',name:"Jeremy Renner",year:2026,rating:8.2,baseValue:110,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:100,awards:8},
  {id:'actor-29',name:"Robert Downey Jr.",year:2026,rating:8.3,baseValue:210,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:72,awards:9},
  {id:'actor-30',name:"Benedict Cumberbatch",year:2026,rating:8.4,baseValue:310,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:73,awards:0},
  {id:'actor-31',name:"Joaquin Phoenix",year:2026,rating:8.5,baseValue:410,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:74,awards:1},
  {id:'actor-32',name:"Jake Gyllenhaal",year:2026,rating:8.6,baseValue:510,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:75,awards:2},
  {id:'actor-33',name:"Edward Norton",year:2026,rating:8.7,baseValue:610,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:76,awards:3},
  {id:'actor-34',name:"Bradley Cooper",year:2026,rating:8.8,baseValue:710,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:77,awards:4},
  {id:'actor-35',name:"Jared Leto",year:2026,rating:8.9,baseValue:810,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:78,awards:5},
  {id:'actor-36',name:"Matthew McConaughey",year:2026,rating:7.2,baseValue:910,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:79,awards:6},
  {id:'actor-37',name:"George Clooney",year:2026,rating:7.3,baseValue:100,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:80,awards:7},
  {id:'actor-38',name:"Michael Fassbender",year:2026,rating:7.4,baseValue:200,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:81,awards:8},
  {id:'actor-39',name:"Oscar Isaac",year:2026,rating:7.5,baseValue:300,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:82,awards:9},
  {id:'actor-40',name:"Pedro Pascal",year:2026,rating:7.6,baseValue:400,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:83,awards:0},
  {id:'actor-41',name:"Javier Bardem",year:2026,rating:7.7,baseValue:500,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:84,awards:1},
  {id:'actor-42',name:"Antonio Banderas",year:2026,rating:7.8,baseValue:600,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:85,awards:2},
  {id:'actor-43',name:"Jean Reno",year:2026,rating:7.9,baseValue:700,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:86,awards:3},
  {id:'actor-44',name:"Mads Mikkelsen",year:2026,rating:8.0,baseValue:800,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:87,awards:4},
  {id:'actor-45',name:"Gary Oldman",year:2026,rating:8.1,baseValue:900,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:88,awards:5},
  {id:'actor-46',name:"Colin Firth",year:2026,rating:8.2,baseValue:90,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:89,awards:6},
  {id:'actor-47',name:"Hugh Grant",year:2026,rating:8.3,baseValue:190,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:90,awards:7},
  {id:'actor-48',name:"Ewan McGregor",year:2026,rating:8.4,baseValue:290,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:91,awards:8},
  {id:'actor-49',name:"Daniel Craig",year:2026,rating:8.5,baseValue:390,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:92,awards:9},
  {id:'actor-50',name:"Pierce Brosnan",year:2026,rating:8.6,baseValue:490,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:93,awards:0},
  {id:'actor-51',name:"Liam Neeson",year:2026,rating:8.7,baseValue:590,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:94,awards:1},
  {id:'actor-52',name:"Ralph Fiennes",year:2026,rating:8.8,baseValue:690,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:95,awards:2},
  {id:'actor-53',name:"Colin Farrell",year:2026,rating:8.9,baseValue:790,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:96,awards:3},
  {id:'actor-54',name:"Cillian Murphy",year:2026,rating:7.2,baseValue:890,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:97,awards:4},
  {id:'actor-55',name:"Barry Keoghan",year:2026,rating:7.3,baseValue:80,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:98,awards:5},
  {id:'actor-56',name:"Paul Mescal",year:2026,rating:7.4,baseValue:180,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:99,awards:6},
  {id:'actor-57',name:"Timothée Chalamet",year:2026,rating:7.5,baseValue:280,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:100,awards:7},
  {id:'actor-58',name:"Austin Butler",year:2026,rating:7.6,baseValue:380,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:72,awards:8},
  {id:'actor-59',name:"Andrew Garfield",year:2026,rating:7.7,baseValue:480,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:73,awards:9},
  {id:'actor-60',name:"Tom Holland",year:2026,rating:7.8,baseValue:580,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:74,awards:0},
  {id:'actor-61',name:"Daniel Radcliffe",year:2026,rating:7.9,baseValue:680,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:75,awards:1},
  {id:'actor-62',name:"Rupert Grint",year:2026,rating:8.0,baseValue:780,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:76,awards:2},
  {id:'actor-63',name:"Kit Harington",year:2026,rating:8.1,baseValue:880,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:77,awards:3},
  {id:'actor-64',name:"Orlando Bloom",year:2026,rating:8.2,baseValue:70,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:78,awards:4},
  {id:'actor-65',name:"Henry Cavill",year:2026,rating:8.3,baseValue:170,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:79,awards:5},
  {id:'actor-66',name:"Idris Elba",year:2026,rating:8.4,baseValue:270,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:80,awards:6},
  {id:'actor-67',name:"John Boyega",year:2026,rating:8.5,baseValue:370,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:81,awards:7},
  {id:'actor-68',name:"Michael B. Jordan",year:2026,rating:8.6,baseValue:470,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:82,awards:8},
  {id:'actor-69',name:"Chadwick Boseman",year:2026,rating:8.7,baseValue:570,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:83,awards:9},
  {id:'actor-70',name:"Forest Whitaker",year:2026,rating:8.8,baseValue:670,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:84,awards:0},
  {id:'actor-71',name:"Samuel L. Jackson",year:2026,rating:8.9,baseValue:770,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:85,awards:1},
  {id:'actor-72',name:"Laurence Fishburne",year:2026,rating:7.2,baseValue:870,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:86,awards:2},
  {id:'actor-73',name:"Wesley Snipes",year:2026,rating:7.3,baseValue:60,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:87,awards:3},
  {id:'actor-74',name:"Jamie Foxx",year:2026,rating:7.4,baseValue:160,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:88,awards:4},
  {id:'actor-75',name:"Don Cheadle",year:2026,rating:7.5,baseValue:260,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:89,awards:5},
  {id:'actor-76',name:"Mahershala Ali",year:2026,rating:7.6,baseValue:360,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:90,awards:6},
  {id:'actor-77',name:"Rami Malek",year:2026,rating:7.7,baseValue:460,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:91,awards:7},
  {id:'actor-78',name:"Dev Patel",year:2026,rating:7.8,baseValue:560,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:92,awards:8},
  {id:'actor-79',name:"Riz Ahmed",year:2026,rating:7.9,baseValue:660,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:93,awards:9},
  {id:'actor-80',name:"Ben Kingsley",year:2026,rating:8.0,baseValue:760,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:94,awards:0},
  {id:'actor-81',name:"Anthony Hopkins",year:2026,rating:8.1,baseValue:860,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:95,awards:1},
  {id:'actor-82',name:"Ian McKellen",year:2026,rating:8.2,baseValue:50,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:96,awards:2},
  {id:'actor-83',name:"Patrick Stewart",year:2026,rating:8.3,baseValue:150,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:97,awards:3},
  {id:'actor-84',name:"Christopher Walken",year:2026,rating:8.4,baseValue:250,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:98,awards:4},
  {id:'actor-85',name:"Jeff Bridges",year:2026,rating:8.5,baseValue:350,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:99,awards:5},
  {id:'actor-86',name:"Kevin Costner",year:2026,rating:8.6,baseValue:450,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:100,awards:6},
  {id:'actor-87',name:"Hugh Laurie",year:2026,rating:8.7,baseValue:550,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:72,awards:7},
  {id:'actor-88',name:"Jim Broadbent",year:2026,rating:8.8,baseValue:650,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:73,awards:8},
  {id:'actor-89',name:"Steve Carell",year:2026,rating:8.9,baseValue:750,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:74,awards:9},
  {id:'actor-90',name:"Bill Murray",year:2026,rating:7.2,baseValue:850,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:75,awards:0},
  {id:'actor-91',name:"Robin Williams",year:2026,rating:7.3,baseValue:40,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:76,awards:1},
  {id:'actor-92',name:"Jack Nicholson",year:2026,rating:7.4,baseValue:140,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:77,awards:2},
  {id:'actor-93',name:"Dustin Hoffman",year:2026,rating:7.5,baseValue:240,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:78,awards:3},
  {id:'actor-94',name:"Gene Hackman",year:2026,rating:7.6,baseValue:340,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:79,awards:4},
  {id:'actor-95',name:"Clint Eastwood",year:2026,rating:7.7,baseValue:440,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:80,awards:5},
  {id:'actor-96',name:"Mel Gibson",year:2026,rating:7.8,baseValue:540,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:81,awards:6},
  {id:'actor-97',name:"Russell Crowe",year:2026,rating:7.9,baseValue:640,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:82,awards:7},
  {id:'actor-98',name:"Jude Law",year:2026,rating:8.0,baseValue:740,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:83,awards:8},
  {id:'actor-99',name:"Joseph Gordon-Levitt",year:2026,rating:8.1,baseValue:840,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:84,awards:9},
  {id:'actor-100',name:"Channing Tatum",year:2026,rating:8.2,baseValue:940,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:85,awards:0},
  {id:'actor-101',name:"Jonah Hill",year:2026,rating:8.3,baseValue:130,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:86,awards:1},
  {id:'actor-102',name:"Seth Rogen",year:2026,rating:8.4,baseValue:230,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:87,awards:2},
  {id:'actor-103',name:"Paul Rudd",year:2026,rating:8.5,baseValue:330,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:88,awards:3},
  {id:'actor-104',name:"Jason Momoa",year:2026,rating:8.6,baseValue:430,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:89,awards:4},
  {id:'actor-105',name:"Dave Bautista",year:2026,rating:8.7,baseValue:530,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:90,awards:5},
  {id:'actor-106',name:"Vin Diesel",year:2026,rating:8.8,baseValue:630,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:91,awards:6},
  {id:'actor-107',name:"Dwayne Johnson",year:2026,rating:8.9,baseValue:730,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:92,awards:7},
  {id:'actor-108',name:"John Cena",year:2026,rating:7.2,baseValue:830,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:93,awards:8},
  {id:'actor-109',name:"Zac Efron",year:2026,rating:7.3,baseValue:930,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:94,awards:9},
  {id:'actor-110',name:"Chris Pine",year:2026,rating:7.4,baseValue:120,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:95,awards:0},
  {id:'actor-111',name:"Miles Teller",year:2026,rating:7.5,baseValue:220,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:96,awards:1},
  {id:'actor-112',name:"Margot Robbie",year:2026,rating:7.6,baseValue:320,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:97,awards:2},
  {id:'actor-113',name:"Scarlett Johansson",year:2026,rating:7.7,baseValue:420,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:98,awards:3},
  {id:'actor-114',name:"Angelina Jolie",year:2026,rating:7.8,baseValue:520,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:99,awards:4},
  {id:'actor-115',name:"Jennifer Lawrence",year:2026,rating:7.9,baseValue:620,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:100,awards:5},
  {id:'actor-116',name:"Emma Stone",year:2026,rating:8.0,baseValue:720,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:72,awards:6},
  {id:'actor-117',name:"Anne Hathaway",year:2026,rating:8.1,baseValue:820,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:73,awards:7},
  {id:'actor-118',name:"Natalie Portman",year:2026,rating:8.2,baseValue:920,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:74,awards:8},
  {id:'actor-119',name:"Meryl Streep",year:2026,rating:8.3,baseValue:110,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:75,awards:9},
  {id:'actor-120',name:"Nicole Kidman",year:2026,rating:8.4,baseValue:210,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:76,awards:0},
  {id:'actor-121',name:"Charlize Theron",year:2026,rating:8.5,baseValue:310,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:77,awards:1},
  {id:'actor-122',name:"Julia Roberts",year:2026,rating:8.6,baseValue:410,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:78,awards:2},
  {id:'actor-123',name:"Sandra Bullock",year:2026,rating:8.7,baseValue:510,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:79,awards:3},
  {id:'actor-124',name:"Cate Blanchett",year:2026,rating:8.8,baseValue:610,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:80,awards:4},
  {id:'actor-125',name:"Amy Adams",year:2026,rating:8.9,baseValue:710,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:81,awards:5},
  {id:'actor-126',name:"Viola Davis",year:2026,rating:7.2,baseValue:810,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:82,awards:6},
  {id:'actor-127',name:"Jodie Foster",year:2026,rating:7.3,baseValue:910,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:83,awards:7},
  {id:'actor-128',name:"Julianne Moore",year:2026,rating:7.4,baseValue:100,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:84,awards:8},
  {id:'actor-129',name:"Frances McDormand",year:2026,rating:7.5,baseValue:200,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:85,awards:9},
  {id:'actor-130',name:"Tilda Swinton",year:2026,rating:7.6,baseValue:300,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:86,awards:0},
  {id:'actor-131',name:"Michelle Yeoh",year:2026,rating:7.7,baseValue:400,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:87,awards:1},
  {id:'actor-132',name:"Salma Hayek",year:2026,rating:7.8,baseValue:500,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:88,awards:2},
  {id:'actor-133',name:"Penélope Cruz",year:2026,rating:7.9,baseValue:600,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:89,awards:3},
  {id:'actor-134',name:"Cameron Diaz",year:2026,rating:8.0,baseValue:700,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:90,awards:4},
  {id:'actor-135',name:"Reese Witherspoon",year:2026,rating:8.1,baseValue:800,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:91,awards:5},
  {id:'actor-136',name:"Jessica Chastain",year:2026,rating:8.2,baseValue:900,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:92,awards:6},
  {id:'actor-137',name:"Emily Blunt",year:2026,rating:8.3,baseValue:90,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:93,awards:7},
  {id:'actor-138',name:"Rachel McAdams",year:2026,rating:8.4,baseValue:190,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:94,awards:8},
  {id:'actor-139',name:"Natalie Dormer",year:2026,rating:8.5,baseValue:290,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:95,awards:9},
  {id:'actor-140',name:"Keira Knightley",year:2026,rating:8.6,baseValue:390,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:96,awards:0},
  {id:'actor-141',name:"Rosamund Pike",year:2026,rating:8.7,baseValue:490,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:97,awards:1},
  {id:'actor-142',name:"Naomi Watts",year:2026,rating:8.8,baseValue:590,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:98,awards:2},
  {id:'actor-143',name:"Eva Green",year:2026,rating:8.9,baseValue:690,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:99,awards:3},
  {id:'actor-144',name:"Marion Cotillard",year:2026,rating:7.2,baseValue:790,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:100,awards:4},
  {id:'actor-145',name:"Léa Seydoux",year:2026,rating:7.3,baseValue:890,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:72,awards:5},
  {id:'actor-146',name:"Saoirse Ronan",year:2026,rating:7.4,baseValue:80,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:73,awards:6},
  {id:'actor-147',name:"Florence Pugh",year:2026,rating:7.5,baseValue:180,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:74,awards:7},
  {id:'actor-148',name:"Anya Taylor-Joy",year:2026,rating:7.6,baseValue:280,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:75,awards:8},
  {id:'actor-149',name:"Zendaya",year:2026,rating:7.7,baseValue:380,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:76,awards:9},
  {id:'actor-150',name:"Emma Watson",year:2026,rating:7.8,baseValue:480,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:77,awards:0},
  {id:'actor-151',name:"Emma Roberts",year:2026,rating:7.9,baseValue:580,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:78,awards:1},
  {id:'actor-152',name:"Millie Bobby Brown",year:2026,rating:8.0,baseValue:680,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:79,awards:2},
  {id:'actor-153',name:"Gal Gadot",year:2026,rating:8.1,baseValue:780,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:80,awards:3},
  {id:'actor-154',name:"Ana de Armas",year:2026,rating:8.2,baseValue:880,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:81,awards:4},
  {id:'actor-155',name:"Jennifer Aniston",year:2026,rating:8.3,baseValue:70,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:82,awards:5},
  {id:'actor-156',name:"Courteney Cox",year:2026,rating:8.4,baseValue:170,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:83,awards:6},
  {id:'actor-157',name:"Lisa Kudrow",year:2026,rating:8.5,baseValue:270,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:84,awards:7},
  {id:'actor-158',name:"Kristen Stewart",year:2026,rating:8.6,baseValue:370,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:85,awards:8},
  {id:'actor-159',name:"Kristen Bell",year:2026,rating:8.7,baseValue:470,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:86,awards:9},
  {id:'actor-160',name:"Amanda Seyfried",year:2026,rating:8.8,baseValue:570,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:87,awards:0},
  {id:'actor-161',name:"Mila Kunis",year:2026,rating:8.9,baseValue:670,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:88,awards:1},
  {id:'actor-162',name:"Dakota Johnson",year:2026,rating:7.2,baseValue:770,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:89,awards:2},
  {id:'actor-163',name:"Brie Larson",year:2026,rating:7.3,baseValue:870,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:90,awards:3},
  {id:'actor-164',name:"Elizabeth Olsen",year:2026,rating:7.4,baseValue:60,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:91,awards:4},
  {id:'actor-165',name:"Zoe Saldana",year:2026,rating:7.5,baseValue:160,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:92,awards:5},
  {id:'actor-166',name:"Michelle Williams",year:2026,rating:7.6,baseValue:260,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:93,awards:6},
  {id:'actor-167',name:"Halle Berry",year:2026,rating:7.7,baseValue:360,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:94,awards:7},
  {id:'actor-168',name:"Regina King",year:2026,rating:7.8,baseValue:460,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:95,awards:8},
  {id:'actor-169',name:"Taraji P. Henson",year:2026,rating:7.9,baseValue:560,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:96,awards:9},
  {id:'actor-170',name:"Octavia Spencer",year:2026,rating:8.0,baseValue:660,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:97,awards:0},
  {id:'actor-171',name:"Whoopi Goldberg",year:2026,rating:8.1,baseValue:760,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:98,awards:1},
  {id:'actor-172',name:"Sigourney Weaver",year:2026,rating:8.2,baseValue:860,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:99,awards:2},
  {id:'actor-173',name:"Linda Hamilton",year:2026,rating:8.3,baseValue:50,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:100,awards:3},
  {id:'actor-174',name:"Demi Moore",year:2026,rating:8.4,baseValue:150,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:72,awards:4},
  {id:'actor-175',name:"Sharon Stone",year:2026,rating:8.5,baseValue:250,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:73,awards:5},
  {id:'actor-176',name:"Winona Ryder",year:2026,rating:8.6,baseValue:350,genre:'ممثل عالمي',rarity:'مميز',rarityClass:'special',img:'',fame:74,awards:6}
];

const countries = [
  {id:'country-1',name:'الإمارات العربية المتحدة',year:2026,rating:9.23,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'آسيا / الخليج',economy:95,tourism:96,safety:94,infrastructure:97,qualityOfLife:88,culture:86,nature:82,entertainment:95,totalScore:92.3},
  {id:'country-2',name:'السعودية',year:2026,rating:8.98,baseValue:720,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'آسيا / الخليج',economy:92,tourism:91,safety:88,infrastructure:90,qualityOfLife:83,culture:94,nature:91,entertainment:88,totalScore:89.8},
  {id:'country-3',name:'قطر',year:2026,rating:8.75,baseValue:700,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'آسيا / الخليج',economy:94,tourism:89,safety:93,infrastructure:92,qualityOfLife:86,culture:78,nature:74,entertainment:84,totalScore:87.5},
  {id:'country-4',name:'الكويت',year:2026,rating:8.16,baseValue:650,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا / الخليج',economy:86,tourism:78,safety:88,infrastructure:84,qualityOfLife:79,culture:82,nature:72,entertainment:78,totalScore:81.6},
  {id:'country-5',name:'البحرين',year:2026,rating:8.18,baseValue:650,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا / الخليج',economy:78,tourism:82,safety:90,infrastructure:86,qualityOfLife:80,culture:84,nature:72,entertainment:82,totalScore:81.8},
  {id:'country-6',name:'عُمان',year:2026,rating:8.55,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا / الخليج',economy:79,tourism:86,safety:92,infrastructure:84,qualityOfLife:82,culture:88,nature:96,entertainment:80,totalScore:85.5},
  {id:'country-7',name:'اليابان',year:2026,rating:9.379999999999999,baseValue:750,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'آسيا',economy:94,tourism:93,safety:96,infrastructure:98,qualityOfLife:90,culture:96,nature:88,entertainment:94,totalScore:93.8},
  {id:'country-8',name:'كوريا الجنوبية',year:2026,rating:9.07,baseValue:730,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'آسيا',economy:92,tourism:89,safety:94,infrastructure:96,qualityOfLife:88,culture:90,nature:78,entertainment:96,totalScore:90.7},
  {id:'country-9',name:'سنغافورة',year:2026,rating:9.24,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'آسيا',economy:99,tourism:91,safety:98,infrastructure:100,qualityOfLife:96,culture:82,nature:72,entertainment:92,totalScore:92.4},
  {id:'country-10',name:'الصين',year:2026,rating:9.25,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'آسيا',economy:98,tourism:90,safety:91,infrastructure:92,qualityOfLife:84,culture:96,nature:94,entertainment:91,totalScore:92.5},
  {id:'country-11',name:'الهند',year:2026,rating:8.47,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا',economy:82,tourism:91,safety:80,infrastructure:75,qualityOfLife:70,culture:98,nature:93,entertainment:90,totalScore:84.7},
  {id:'country-12',name:'إندونيسيا',year:2026,rating:8.209999999999999,baseValue:660,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا',economy:76,tourism:88,safety:78,infrastructure:72,qualityOfLife:74,culture:90,nature:98,entertainment:86,totalScore:82.1},
  {id:'country-13',name:'تايلاند',year:2026,rating:8.52,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا',economy:75,tourism:94,safety:84,infrastructure:78,qualityOfLife:80,culture:88,nature:96,entertainment:93,totalScore:85.2},
  {id:'country-14',name:'ماليزيا',year:2026,rating:8.559999999999999,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا',economy:79,tourism:89,safety:88,infrastructure:84,qualityOfLife:82,culture:87,nature:92,entertainment:88,totalScore:85.6},
  {id:'country-15',name:'تركيا',year:2026,rating:8.709999999999999,baseValue:700,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'آسيا / أوروبا',economy:82,tourism:93,safety:84,infrastructure:83,qualityOfLife:78,culture:98,nature:92,entertainment:91,totalScore:87.1},
  {id:'country-16',name:'إسرائيل',year:2026,rating:8.47,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا',economy:90,tourism:85,safety:78,infrastructure:92,qualityOfLife:82,culture:86,nature:75,entertainment:87,totalScore:84.7},
  {id:'country-17',name:'أستراليا',year:2026,rating:9.42,baseValue:750,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوقيانوسيا',economy:93,tourism:94,safety:95,infrastructure:96,qualityOfLife:92,culture:91,nature:99,entertainment:94,totalScore:94.2},
  {id:'country-18',name:'نيوزيلندا',year:2026,rating:9.15,baseValue:730,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوقيانوسيا',economy:84,tourism:92,safety:96,infrastructure:91,qualityOfLife:93,culture:91,nature:100,entertainment:90,totalScore:91.5},
  {id:'country-19',name:'الولايات المتحدة',year:2026,rating:9.41,baseValue:750,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أمريكا الشمالية',economy:100,tourism:96,safety:82,infrastructure:95,qualityOfLife:86,culture:96,nature:97,entertainment:100,totalScore:94.1},
  {id:'country-20',name:'كندا',year:2026,rating:9.35,baseValue:750,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أمريكا الشمالية',economy:94,tourism:91,safety:95,infrastructure:94,qualityOfLife:93,culture:92,nature:98,entertainment:91,totalScore:93.5},
  {id:'country-21',name:'المكسيك',year:2026,rating:8.49,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أمريكا الشمالية',economy:78,tourism:94,safety:78,infrastructure:76,qualityOfLife:75,culture:97,nature:95,entertainment:92,totalScore:84.9},
  {id:'country-22',name:'البرازيل',year:2026,rating:8.559999999999999,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أمريكا الجنوبية',economy:82,tourism:93,safety:76,infrastructure:74,qualityOfLife:73,culture:96,nature:100,entertainment:95,totalScore:85.6},
  {id:'country-23',name:'الأرجنتين',year:2026,rating:8.309999999999999,baseValue:660,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أمريكا الجنوبية',economy:72,tourism:90,safety:78,infrastructure:77,qualityOfLife:76,culture:96,nature:96,entertainment:90,totalScore:83.1},
  {id:'country-24',name:'تشيلي',year:2026,rating:8.61,baseValue:690,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أمريكا الجنوبية',economy:78,tourism:87,safety:88,infrastructure:86,qualityOfLife:82,culture:91,nature:99,entertainment:84,totalScore:86.1},
  {id:'country-25',name:'كولومبيا',year:2026,rating:8.23,baseValue:660,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أمريكا الجنوبية',economy:75,tourism:91,safety:74,infrastructure:72,qualityOfLife:73,culture:94,nature:97,entertainment:90,totalScore:82.3},
  {id:'country-26',name:'بيرو',year:2026,rating:8.02,baseValue:640,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أمريكا الجنوبية',economy:68,tourism:89,safety:76,infrastructure:70,qualityOfLife:69,culture:99,nature:96,entertainment:84,totalScore:80.2},
  {id:'country-27',name:'أوروغواي',year:2026,rating:8.27,baseValue:660,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أمريكا الجنوبية',economy:70,tourism:86,safety:91,infrastructure:83,qualityOfLife:84,culture:87,nature:88,entertainment:80,totalScore:82.7},
  {id:'country-28',name:'فرنسا',year:2026,rating:9.4,baseValue:750,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:91,tourism:99,safety:89,infrastructure:95,qualityOfLife:90,culture:100,nature:92,entertainment:99,totalScore:94.0},
  {id:'country-29',name:'إيطاليا',year:2026,rating:9.059999999999999,baseValue:720,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:84,tourism:98,safety:86,infrastructure:88,qualityOfLife:82,culture:100,nature:95,entertainment:97,totalScore:90.6},
  {id:'country-30',name:'إسبانيا',year:2026,rating:9.32,baseValue:750,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:87,tourism:98,safety:91,infrastructure:93,qualityOfLife:88,culture:98,nature:96,entertainment:99,totalScore:93.2},
  {id:'country-31',name:'ألمانيا',year:2026,rating:9.28,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:94,tourism:94,safety:93,infrastructure:98,qualityOfLife:91,culture:93,nature:86,entertainment:92,totalScore:92.8},
  {id:'country-32',name:'المملكة المتحدة',year:2026,rating:9.3,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:93,tourism:96,safety:89,infrastructure:94,qualityOfLife:88,culture:99,nature:88,entertainment:98,totalScore:93.0},
  {id:'country-33',name:'سويسرا',year:2026,rating:9.53,baseValue:760,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:96,tourism:94,safety:98,infrastructure:99,qualityOfLife:97,culture:94,nature:93,entertainment:90,totalScore:95.3},
  {id:'country-34',name:'النمسا',year:2026,rating:9.22,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:83,tourism:93,safety:96,infrastructure:95,qualityOfLife:94,culture:96,nature:97,entertainment:91,totalScore:92.2},
  {id:'country-35',name:'هولندا',year:2026,rating:9.14,baseValue:730,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:89,tourism:92,safety:94,infrastructure:98,qualityOfLife:93,culture:91,nature:82,entertainment:93,totalScore:91.4},
  {id:'country-36',name:'بلجيكا',year:2026,rating:8.85,baseValue:710,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:82,tourism:90,safety:92,infrastructure:93,qualityOfLife:88,culture:95,nature:80,entertainment:92,totalScore:88.5},
  {id:'country-37',name:'النرويج',year:2026,rating:9.379999999999999,baseValue:750,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:90,tourism:91,safety:98,infrastructure:97,qualityOfLife:97,culture:93,nature:100,entertainment:88,totalScore:93.8},
  {id:'country-38',name:'السويد',year:2026,rating:9.25,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:88,tourism:90,safety:97,infrastructure:96,qualityOfLife:96,culture:94,nature:92,entertainment:91,totalScore:92.5},
  {id:'country-39',name:'الدنمارك',year:2026,rating:9.22,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:87,tourism:91,safety:98,infrastructure:97,qualityOfLife:97,culture:93,nature:86,entertainment:92,totalScore:92.2},
  {id:'country-40',name:'فنلندا',year:2026,rating:9.2,baseValue:740,genre:'دولة',rarity:'أسطوري',rarityClass:'legendary',img:'',region:'أوروبا',economy:84,tourism:88,safety:99,infrastructure:96,qualityOfLife:98,culture:92,nature:98,entertainment:87,totalScore:92.0},
  {id:'country-41',name:'آيسلندا',year:2026,rating:8.99,baseValue:720,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:72,tourism:95,safety:99,infrastructure:91,qualityOfLife:94,culture:91,nature:100,entertainment:88,totalScore:89.9},
  {id:'country-42',name:'أيرلندا',year:2026,rating:9.17,baseValue:730,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:86,tourism:92,safety:96,infrastructure:94,qualityOfLife:92,culture:94,nature:93,entertainment:90,totalScore:91.7},
  {id:'country-43',name:'البرتغال',year:2026,rating:9.0,baseValue:720,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:78,tourism:96,safety:93,infrastructure:89,qualityOfLife:87,culture:95,nature:95,entertainment:94,totalScore:90.0},
  {id:'country-44',name:'اليونان',year:2026,rating:8.68,baseValue:690,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:73,tourism:96,safety:87,infrastructure:80,qualityOfLife:82,culture:99,nature:96,entertainment:91,totalScore:86.8},
  {id:'country-45',name:'التشيك',year:2026,rating:8.709999999999999,baseValue:700,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:76,tourism:88,safety:94,infrastructure:89,qualityOfLife:88,culture:93,nature:87,entertainment:89,totalScore:87.1},
  {id:'country-46',name:'بولندا',year:2026,rating:8.57,baseValue:690,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أوروبا',economy:78,tourism:86,safety:90,infrastructure:88,qualityOfLife:84,culture:91,nature:86,entertainment:88,totalScore:85.7},
  {id:'country-47',name:'المجر',year:2026,rating:8.32,baseValue:670,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أوروبا',economy:69,tourism:90,safety:89,infrastructure:82,qualityOfLife:82,culture:94,nature:80,entertainment:88,totalScore:83.2},
  {id:'country-48',name:'رومانيا',year:2026,rating:8.17,baseValue:650,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أوروبا',economy:68,tourism:88,safety:84,infrastructure:76,qualityOfLife:77,culture:92,nature:94,entertainment:84,totalScore:81.7},
  {id:'country-49',name:'كرواتيا',year:2026,rating:8.67,baseValue:690,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:70,tourism:96,safety:91,infrastructure:84,qualityOfLife:86,culture:92,nature:95,entertainment:89,totalScore:86.7},
  {id:'country-50',name:'سلوفينيا',year:2026,rating:8.84,baseValue:710,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',region:'أوروبا',economy:72,tourism:92,safety:96,infrastructure:91,qualityOfLife:93,culture:91,nature:96,entertainment:87,totalScore:88.4},
  {id:'country-51',name:'صربيا',year:2026,rating:8.02,baseValue:640,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أوروبا',economy:65,tourism:87,safety:83,infrastructure:75,qualityOfLife:75,culture:93,nature:86,entertainment:88,totalScore:80.2},
  {id:'country-52',name:'روسيا',year:2026,rating:8.33,baseValue:670,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أوروبا / آسيا',economy:86,tourism:78,safety:74,infrastructure:82,qualityOfLife:69,culture:98,nature:96,entertainment:88,totalScore:83.3},
  {id:'country-53',name:'جنوب أفريقيا',year:2026,rating:7.909999999999999,baseValue:630,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:68,tourism:88,safety:67,infrastructure:72,qualityOfLife:68,culture:94,nature:99,entertainment:89,totalScore:79.1},
  {id:'country-54',name:'مصر',year:2026,rating:8.05,baseValue:640,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:67,tourism:94,safety:73,infrastructure:70,qualityOfLife:69,culture:100,nature:92,entertainment:90,totalScore:80.5},
  {id:'country-55',name:'المغرب',year:2026,rating:8.48,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:70,tourism:95,safety:84,infrastructure:78,qualityOfLife:77,culture:97,nature:95,entertainment:92,totalScore:84.8},
  {id:'country-56',name:'تونس',year:2026,rating:8.15,baseValue:650,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:63,tourism:93,safety:86,infrastructure:75,qualityOfLife:76,culture:94,nature:88,entertainment:87,totalScore:81.5},
  {id:'country-57',name:'الجزائر',year:2026,rating:7.9,baseValue:630,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:66,tourism:84,safety:82,infrastructure:70,qualityOfLife:69,culture:95,nature:96,entertainment:79,totalScore:79.0},
  {id:'country-58',name:'كينيا',year:2026,rating:7.7700000000000005,baseValue:620,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',region:'أفريقيا',economy:61,tourism:91,safety:72,infrastructure:68,qualityOfLife:67,culture:92,nature:99,entertainment:84,totalScore:77.7},
  {id:'country-59',name:'نيجيريا',year:2026,rating:7.57,baseValue:610,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',region:'أفريقيا',economy:72,tourism:83,safety:65,infrastructure:64,qualityOfLife:62,culture:91,nature:88,entertainment:86,totalScore:75.7},
  {id:'country-60',name:'إثيوبيا',year:2026,rating:7.220000000000001,baseValue:580,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',region:'أفريقيا',economy:52,tourism:86,safety:67,infrastructure:60,qualityOfLife:61,culture:97,nature:95,entertainment:76,totalScore:72.2},
  {id:'country-61',name:'تنزانيا',year:2026,rating:7.82,baseValue:630,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:58,tourism:94,safety:78,infrastructure:66,qualityOfLife:70,culture:92,nature:100,entertainment:80,totalScore:78.2},
  {id:'country-62',name:'موريشيوس',year:2026,rating:8.53,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:65,tourism:96,safety:94,infrastructure:82,qualityOfLife:87,culture:85,nature:98,entertainment:86,totalScore:85.3},
  {id:'country-63',name:'سيشل',year:2026,rating:8.379999999999999,baseValue:670,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'أفريقيا',economy:55,tourism:99,safety:96,infrastructure:79,qualityOfLife:90,culture:82,nature:100,entertainment:84,totalScore:83.8},
  {id:'country-64',name:'فيتنام',year:2026,rating:8.47,baseValue:680,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا',economy:76,tourism:91,safety:85,infrastructure:79,qualityOfLife:78,culture:92,nature:94,entertainment:88,totalScore:84.7},
  {id:'country-65',name:'الفلبين',year:2026,rating:8.24,baseValue:660,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',region:'آسيا',economy:72,tourism:90,safety:79,infrastructure:73,qualityOfLife:75,culture:91,nature:97,entertainment:91,totalScore:82.4},
  {id:'country-66',name:'أفغانستان',year:2026,rating:7.62,baseValue:570,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'af',region:'آسيا',economy:73,tourism:72,safety:72,infrastructure:85,qualityOfLife:75,culture:72,nature:83,entertainment:78,totalScore:76.2},
  {id:'country-67',name:'ألبانيا',year:2026,rating:8.04,baseValue:600,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'al',region:'أوروبا',economy:77,tourism:76,safety:88,infrastructure:83,qualityOfLife:79,culture:86,nature:75,entertainment:79,totalScore:80.4},
  {id:'country-68',name:'أندورا',year:2026,rating:8.38,baseValue:630,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ad',region:'أوروبا',economy:88,tourism:81,safety:79,infrastructure:90,qualityOfLife:89,culture:79,nature:76,entertainment:88,totalScore:83.8},
  {id:'country-69',name:'أنغولا',year:2026,rating:6.94,baseValue:520,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ao',region:'أفريقيا',economy:76,tourism:66,safety:67,infrastructure:71,qualityOfLife:67,culture:66,nature:77,entertainment:65,totalScore:69.4},
  {id:'country-70',name:'أنتيغوا وبربودا',year:2026,rating:7.02,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ag',region:'الكاريبي',economy:76,tourism:74,safety:65,infrastructure:67,qualityOfLife:69,culture:68,nature:75,entertainment:68,totalScore:70.2},
  {id:'country-71',name:'أرمينيا',year:2026,rating:7.31,baseValue:550,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'am',region:'أوروبا / آسيا',economy:73,tourism:75,safety:77,infrastructure:70,qualityOfLife:75,culture:72,nature:73,entertainment:70,totalScore:73.1},
  {id:'country-72',name:'أذربيجان',year:2026,rating:8.18,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'az',region:'أوروبا / آسيا',economy:79,tourism:86,safety:85,infrastructure:75,qualityOfLife:76,culture:85,nature:88,entertainment:80,totalScore:81.8},
  {id:'country-73',name:'الباهاما',year:2026,rating:7.42,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'bs',region:'الكاريبي',economy:76,tourism:77,safety:78,infrastructure:75,qualityOfLife:77,culture:71,nature:69,entertainment:71,totalScore:74.2},
  {id:'country-74',name:'بنغلاديش',year:2026,rating:7.78,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'bd',region:'آسيا',economy:81,tourism:73,safety:76,infrastructure:81,qualityOfLife:80,culture:79,nature:82,entertainment:70,totalScore:77.8},
  {id:'country-75',name:'باربادوس',year:2026,rating:7.08,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'bb',region:'الكاريبي',economy:68,tourism:67,safety:72,infrastructure:76,qualityOfLife:66,culture:69,nature:77,entertainment:71,totalScore:70.8},
  {id:'country-76',name:'بيلاروسيا',year:2026,rating:8.11,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'by',region:'أوروبا',economy:79,tourism:78,safety:80,infrastructure:80,qualityOfLife:76,culture:88,nature:89,entertainment:79,totalScore:81.1},
  {id:'country-77',name:'بليز',year:2026,rating:7.14,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'bz',region:'أمريكا الوسطى',economy:65,tourism:66,safety:66,infrastructure:77,qualityOfLife:67,culture:73,nature:81,entertainment:76,totalScore:71.4},
  {id:'country-78',name:'بنين',year:2026,rating:6.81,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'bj',region:'أفريقيا',economy:67,tourism:64,safety:66,infrastructure:75,qualityOfLife:68,culture:68,nature:67,entertainment:70,totalScore:68.1},
  {id:'country-79',name:'بوتان',year:2026,rating:8.82,baseValue:660,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'bt',region:'آسيا',economy:79,tourism:86,safety:94,infrastructure:88,qualityOfLife:91,culture:85,nature:94,entertainment:89,totalScore:88.2},
  {id:'country-80',name:'بوليفيا',year:2026,rating:8.00,baseValue:600,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'bo',region:'أمريكا الجنوبية',economy:78,tourism:78,safety:84,infrastructure:81,qualityOfLife:84,culture:79,nature:81,entertainment:75,totalScore:80.0},
  {id:'country-81',name:'البوسنة والهرسك',year:2026,rating:8.55,baseValue:640,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'ba',region:'أوروبا',economy:91,tourism:91,safety:91,infrastructure:91,qualityOfLife:76,culture:83,nature:77,entertainment:84,totalScore:85.5},
  {id:'country-82',name:'بوتسوانا',year:2026,rating:6.72,baseValue:500,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'bw',region:'أفريقيا',economy:65,tourism:64,safety:73,infrastructure:66,qualityOfLife:68,culture:63,nature:70,entertainment:69,totalScore:67.2},
  {id:'country-83',name:'بروناي',year:2026,rating:8.56,baseValue:640,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'bn',region:'آسيا',economy:84,tourism:87,safety:84,infrastructure:86,qualityOfLife:82,culture:84,nature:94,entertainment:84,totalScore:85.6},
  {id:'country-84',name:'بلغاريا',year:2026,rating:7.45,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'bg',region:'أوروبا',economy:75,tourism:73,safety:71,infrastructure:78,qualityOfLife:86,culture:71,nature:69,entertainment:73,totalScore:74.5},
  {id:'country-85',name:'بوركينا فاسو',year:2026,rating:7.30,baseValue:550,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'bf',region:'أفريقيا',economy:76,tourism:74,safety:73,infrastructure:72,qualityOfLife:73,culture:79,nature:63,entertainment:74,totalScore:73.0},
  {id:'country-86',name:'بوروندي',year:2026,rating:6.22,baseValue:470,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'bi',region:'أفريقيا',economy:62,tourism:63,safety:60,infrastructure:61,qualityOfLife:63,culture:62,nature:62,entertainment:65,totalScore:62.2},
  {id:'country-87',name:'الرأس الأخضر',year:2026,rating:6.74,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'cv',region:'أفريقيا',economy:73,tourism:69,safety:68,infrastructure:73,qualityOfLife:61,culture:59,nature:72,entertainment:64,totalScore:67.4},
  {id:'country-88',name:'كمبوديا',year:2026,rating:7.51,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'kh',region:'آسيا',economy:74,tourism:73,safety:77,infrastructure:77,qualityOfLife:71,culture:77,nature:78,entertainment:74,totalScore:75.1},
  {id:'country-89',name:'الكاميرون',year:2026,rating:7.20,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'cm',region:'أفريقيا',economy:67,tourism:78,safety:73,infrastructure:66,qualityOfLife:79,culture:69,nature:70,entertainment:74,totalScore:72.0},
  {id:'country-90',name:'جمهورية أفريقيا الوسطى',year:2026,rating:6.38,baseValue:480,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'cf',region:'أفريقيا',economy:57,tourism:61,safety:66,infrastructure:71,qualityOfLife:59,culture:69,nature:66,entertainment:61,totalScore:63.8},
  {id:'country-91',name:'تشاد',year:2026,rating:6.55,baseValue:490,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'td',region:'أفريقيا',economy:62,tourism:72,safety:59,infrastructure:68,qualityOfLife:58,culture:68,nature:69,entertainment:68,totalScore:65.5},
  {id:'country-92',name:'جزر القمر',year:2026,rating:7.44,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'km',region:'أفريقيا',economy:76,tourism:79,safety:80,infrastructure:74,qualityOfLife:67,culture:71,nature:78,entertainment:70,totalScore:74.4},
  {id:'country-93',name:'جمهورية الكونغو',year:2026,rating:7.19,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'cg',region:'أفريقيا',economy:73,tourism:77,safety:68,infrastructure:71,qualityOfLife:66,culture:71,nature:73,entertainment:76,totalScore:71.9},
  {id:'country-94',name:'جمهورية الكونغو الديمقراطية',year:2026,rating:6.90,baseValue:520,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'cd',region:'أفريقيا',economy:66,tourism:66,safety:66,infrastructure:68,qualityOfLife:71,culture:70,nature:74,entertainment:71,totalScore:69.0},
  {id:'country-95',name:'كوستاريكا',year:2026,rating:6.79,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'cr',region:'أمريكا الوسطى',economy:71,tourism:70,safety:71,infrastructure:63,qualityOfLife:62,culture:67,nature:72,entertainment:67,totalScore:67.9},
  {id:'country-96',name:'ساحل العاج',year:2026,rating:7.30,baseValue:550,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ci',region:'أفريقيا',economy:68,tourism:78,safety:68,infrastructure:70,qualityOfLife:79,culture:78,nature:74,entertainment:69,totalScore:73.0},
  {id:'country-97',name:'كوبا',year:2026,rating:7.68,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'cu',region:'الكاريبي',economy:70,tourism:83,safety:70,infrastructure:74,qualityOfLife:83,culture:82,nature:73,entertainment:79,totalScore:76.8},
  {id:'country-98',name:'قبرص',year:2026,rating:8.28,baseValue:620,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'cy',region:'أوروبا',economy:91,tourism:77,safety:81,infrastructure:87,qualityOfLife:91,culture:81,nature:75,entertainment:79,totalScore:82.8},
  {id:'country-99',name:'جيبوتي',year:2026,rating:7.41,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'dj',region:'أفريقيا',economy:82,tourism:70,safety:66,infrastructure:79,qualityOfLife:78,culture:76,nature:73,entertainment:69,totalScore:74.1},
  {id:'country-100',name:'دومينيكا',year:2026,rating:7.70,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'dm',region:'الكاريبي',economy:74,tourism:70,safety:82,infrastructure:69,qualityOfLife:83,culture:72,nature:83,entertainment:83,totalScore:77.0},
  {id:'country-101',name:'جمهورية الدومينيكان',year:2026,rating:6.75,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'do',region:'الكاريبي',economy:65,tourism:74,safety:66,infrastructure:63,qualityOfLife:72,culture:68,nature:69,entertainment:63,totalScore:67.5},
  {id:'country-102',name:'الإكوادور',year:2026,rating:8.22,baseValue:620,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ec',region:'أمريكا الجنوبية',economy:80,tourism:83,safety:78,infrastructure:78,qualityOfLife:86,culture:86,nature:90,entertainment:77,totalScore:82.2},
  {id:'country-103',name:'السلفادور',year:2026,rating:6.50,baseValue:490,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'sv',region:'أمريكا الوسطى',economy:67,tourism:62,safety:67,infrastructure:64,qualityOfLife:69,culture:72,nature:58,entertainment:61,totalScore:65.0},
  {id:'country-104',name:'غينيا الاستوائية',year:2026,rating:7.04,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'gq',region:'أفريقيا',economy:75,tourism:73,safety:71,infrastructure:74,qualityOfLife:74,culture:64,nature:65,entertainment:67,totalScore:70.4},
  {id:'country-105',name:'إريتريا',year:2026,rating:6.32,baseValue:470,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'er',region:'أفريقيا',economy:61,tourism:69,safety:66,infrastructure:70,qualityOfLife:61,culture:58,nature:57,entertainment:64,totalScore:63.2},
  {id:'country-106',name:'إستونيا',year:2026,rating:8.85,baseValue:660,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'ee',region:'أوروبا',economy:94,tourism:93,safety:83,infrastructure:84,qualityOfLife:93,culture:82,nature:87,entertainment:92,totalScore:88.5},
  {id:'country-107',name:'إسواتيني',year:2026,rating:7.70,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'sz',region:'أفريقيا',economy:72,tourism:76,safety:73,infrastructure:79,qualityOfLife:74,culture:78,nature:83,entertainment:81,totalScore:77.0},
  {id:'country-108',name:'فيجي',year:2026,rating:8.39,baseValue:630,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'fj',region:'أوقيانوسيا',economy:82,tourism:82,safety:81,infrastructure:85,qualityOfLife:81,culture:88,nature:92,entertainment:80,totalScore:83.9},
  {id:'country-109',name:'الغابون',year:2026,rating:6.22,baseValue:470,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ga',region:'أفريقيا',economy:65,tourism:64,safety:58,infrastructure:64,qualityOfLife:56,culture:64,nature:67,entertainment:60,totalScore:62.2},
  {id:'country-110',name:'غامبيا',year:2026,rating:7.02,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'gm',region:'أفريقيا',economy:66,tourism:70,safety:75,infrastructure:74,qualityOfLife:72,culture:69,nature:72,entertainment:64,totalScore:70.2},
  {id:'country-111',name:'جورجيا',year:2026,rating:7.70,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ge',region:'أوروبا / آسيا',economy:79,tourism:84,safety:77,infrastructure:77,qualityOfLife:76,culture:77,nature:69,entertainment:77,totalScore:77.0},
  {id:'country-112',name:'غانا',year:2026,rating:6.86,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'gh',region:'أفريقيا',economy:76,tourism:69,safety:72,infrastructure:69,qualityOfLife:63,culture:68,nature:65,entertainment:67,totalScore:68.6},
  {id:'country-113',name:'غرينادا',year:2026,rating:7.55,baseValue:570,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'gd',region:'الكاريبي',economy:75,tourism:69,safety:80,infrastructure:70,qualityOfLife:77,culture:69,nature:82,entertainment:82,totalScore:75.5},
  {id:'country-114',name:'غواتيمالا',year:2026,rating:7.58,baseValue:570,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'gt',region:'أمريكا الوسطى',economy:83,tourism:72,safety:75,infrastructure:68,qualityOfLife:80,culture:72,nature:75,entertainment:81,totalScore:75.8},
  {id:'country-115',name:'غينيا',year:2026,rating:6.45,baseValue:480,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'gn',region:'أفريقيا',economy:56,tourism:67,safety:63,infrastructure:64,qualityOfLife:65,culture:68,nature:72,entertainment:61,totalScore:64.5},
  {id:'country-116',name:'غينيا بيساو',year:2026,rating:6.45,baseValue:480,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'gw',region:'أفريقيا',economy:68,tourism:60,safety:64,infrastructure:69,qualityOfLife:56,culture:67,nature:71,entertainment:61,totalScore:64.5},
  {id:'country-117',name:'غيانا',year:2026,rating:7.25,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'gy',region:'أمريكا الجنوبية',economy:70,tourism:74,safety:65,infrastructure:76,qualityOfLife:80,culture:76,nature:64,entertainment:75,totalScore:72.5},
  {id:'country-118',name:'هايتي',year:2026,rating:7.56,baseValue:570,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ht',region:'الكاريبي',economy:74,tourism:79,safety:70,infrastructure:77,qualityOfLife:77,culture:79,nature:79,entertainment:70,totalScore:75.6},
  {id:'country-119',name:'هندوراس',year:2026,rating:6.92,baseValue:520,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'hn',region:'أمريكا الوسطى',economy:65,tourism:71,safety:76,infrastructure:67,qualityOfLife:60,culture:74,nature:66,entertainment:75,totalScore:69.2},
  {id:'country-120',name:'إيران',year:2026,rating:7.12,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ir',region:'آسيا / الشرق الأوسط',economy:77,tourism:68,safety:70,infrastructure:74,qualityOfLife:64,culture:73,nature:80,entertainment:64,totalScore:71.2},
  {id:'country-121',name:'العراق',year:2026,rating:7.39,baseValue:550,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'iq',region:'آسيا / الشرق الأوسط',economy:71,tourism:71,safety:71,infrastructure:74,qualityOfLife:79,culture:78,nature:73,entertainment:74,totalScore:73.9},
  {id:'country-122',name:'جامايكا',year:2026,rating:7.18,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'jm',region:'الكاريبي',economy:68,tourism:68,safety:81,infrastructure:66,qualityOfLife:78,culture:66,nature:78,entertainment:69,totalScore:71.8},
  {id:'country-123',name:'الأردن',year:2026,rating:8.32,baseValue:620,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'jo',region:'آسيا / الشرق الأوسط',economy:81,tourism:84,safety:83,infrastructure:81,qualityOfLife:79,culture:89,nature:82,entertainment:87,totalScore:83.2},
  {id:'country-124',name:'كازاخستان',year:2026,rating:8.15,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'kz',region:'آسيا',economy:82,tourism:83,safety:84,infrastructure:85,qualityOfLife:79,culture:81,nature:79,entertainment:79,totalScore:81.5},
  {id:'country-125',name:'كيريباتي',year:2026,rating:8.80,baseValue:660,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'ki',region:'أوقيانوسيا',economy:94,tourism:84,safety:87,infrastructure:86,qualityOfLife:94,culture:85,nature:83,entertainment:91,totalScore:88.0},
  {id:'country-126',name:'كوريا الشمالية',year:2026,rating:9.08,baseValue:680,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'kp',region:'آسيا',economy:91,tourism:94,safety:89,infrastructure:87,qualityOfLife:91,culture:92,nature:91,entertainment:91,totalScore:90.8},
  {id:'country-127',name:'قيرغيزستان',year:2026,rating:8.36,baseValue:630,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'kg',region:'آسيا',economy:79,tourism:85,safety:80,infrastructure:93,qualityOfLife:85,culture:87,nature:77,entertainment:83,totalScore:83.6},
  {id:'country-128',name:'لاوس',year:2026,rating:7.94,baseValue:600,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'la',region:'آسيا',economy:86,tourism:78,safety:86,infrastructure:77,qualityOfLife:76,culture:77,nature:79,entertainment:76,totalScore:79.4},
  {id:'country-129',name:'لاتفيا',year:2026,rating:7.75,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'lv',region:'أوروبا',economy:83,tourism:73,safety:73,infrastructure:74,qualityOfLife:77,culture:83,nature:77,entertainment:80,totalScore:77.5},
  {id:'country-130',name:'لبنان',year:2026,rating:7.46,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'lb',region:'آسيا / الشرق الأوسط',economy:74,tourism:80,safety:73,infrastructure:75,qualityOfLife:65,culture:76,nature:79,entertainment:75,totalScore:74.6},
  {id:'country-131',name:'ليسوتو',year:2026,rating:7.52,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ls',region:'أفريقيا',economy:80,tourism:70,safety:70,infrastructure:79,qualityOfLife:77,culture:74,nature:82,entertainment:70,totalScore:75.2},
  {id:'country-132',name:'ليبيريا',year:2026,rating:7.09,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'lr',region:'أفريقيا',economy:75,tourism:65,safety:77,infrastructure:68,qualityOfLife:70,culture:71,nature:67,entertainment:74,totalScore:70.9},
  {id:'country-133',name:'ليبيا',year:2026,rating:6.72,baseValue:500,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ly',region:'أفريقيا',economy:67,tourism:62,safety:70,infrastructure:65,qualityOfLife:71,culture:67,nature:72,entertainment:64,totalScore:67.2},
  {id:'country-134',name:'ليختنشتاين',year:2026,rating:7.74,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'li',region:'أوروبا',economy:73,tourism:78,safety:80,infrastructure:76,qualityOfLife:80,culture:76,nature:72,entertainment:84,totalScore:77.4},
  {id:'country-135',name:'ليتوانيا',year:2026,rating:9.00,baseValue:680,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'lt',region:'أوروبا',economy:89,tourism:92,safety:86,infrastructure:92,qualityOfLife:83,culture:96,nature:89,entertainment:93,totalScore:90.0},
  {id:'country-136',name:'لوكسمبورغ',year:2026,rating:8.12,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'lu',region:'أوروبا',economy:79,tourism:77,safety:86,infrastructure:81,qualityOfLife:77,culture:87,nature:81,entertainment:82,totalScore:81.2},
  {id:'country-137',name:'مدغشقر',year:2026,rating:6.44,baseValue:480,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'mg',region:'أفريقيا',economy:63,tourism:68,safety:72,infrastructure:65,qualityOfLife:57,culture:64,nature:56,entertainment:70,totalScore:64.4},
  {id:'country-138',name:'ملاوي',year:2026,rating:7.76,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'mw',region:'أفريقيا',economy:76,tourism:79,safety:81,infrastructure:77,qualityOfLife:80,culture:79,nature:72,entertainment:77,totalScore:77.6},
  {id:'country-139',name:'المالديف',year:2026,rating:8.05,baseValue:600,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'mv',region:'آسيا',economy:82,tourism:77,safety:86,infrastructure:84,qualityOfLife:76,culture:78,nature:78,entertainment:83,totalScore:80.5},
  {id:'country-140',name:'مالي',year:2026,rating:7.46,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ml',region:'أفريقيا',economy:72,tourism:72,safety:71,infrastructure:75,qualityOfLife:78,culture:79,nature:83,entertainment:67,totalScore:74.6},
  {id:'country-141',name:'مالطا',year:2026,rating:7.84,baseValue:590,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'mt',region:'أوروبا',economy:75,tourism:71,safety:74,infrastructure:82,qualityOfLife:83,culture:77,nature:86,entertainment:79,totalScore:78.4},
  {id:'country-142',name:'جزر مارشال',year:2026,rating:8.10,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'mh',region:'أوقيانوسيا',economy:75,tourism:78,safety:83,infrastructure:81,qualityOfLife:87,culture:81,nature:87,entertainment:76,totalScore:81.0},
  {id:'country-143',name:'موريتانيا',year:2026,rating:6.06,baseValue:450,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'mr',region:'أفريقيا',economy:61,tourism:60,safety:59,infrastructure:58,qualityOfLife:56,culture:63,nature:66,entertainment:62,totalScore:60.6},
  {id:'country-144',name:'ميكرونيزيا',year:2026,rating:7.85,baseValue:590,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'fm',region:'أوقيانوسيا',economy:77,tourism:78,safety:73,infrastructure:80,qualityOfLife:83,culture:74,nature:84,entertainment:79,totalScore:78.5},
  {id:'country-145',name:'مولدوفا',year:2026,rating:8.79,baseValue:660,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'md',region:'أوروبا',economy:89,tourism:85,safety:90,infrastructure:85,qualityOfLife:94,culture:88,nature:84,entertainment:88,totalScore:87.9},
  {id:'country-146',name:'موناكو',year:2026,rating:8.28,baseValue:620,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'mc',region:'أوروبا',economy:89,tourism:75,safety:78,infrastructure:89,qualityOfLife:77,culture:81,nature:85,entertainment:88,totalScore:82.8},
  {id:'country-147',name:'منغوليا',year:2026,rating:7.98,baseValue:600,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'mn',region:'آسيا',economy:75,tourism:89,safety:79,infrastructure:87,qualityOfLife:74,culture:82,nature:77,entertainment:75,totalScore:79.8},
  {id:'country-148',name:'الجبل الأسود',year:2026,rating:8.69,baseValue:650,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'me',region:'أوروبا',economy:82,tourism:90,safety:82,infrastructure:90,qualityOfLife:91,culture:89,nature:92,entertainment:79,totalScore:86.9},
  {id:'country-149',name:'موزمبيق',year:2026,rating:7.18,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'mz',region:'أفريقيا',economy:68,tourism:70,safety:66,infrastructure:78,qualityOfLife:70,culture:80,nature:65,entertainment:77,totalScore:71.8},
  {id:'country-150',name:'ميانمار',year:2026,rating:8.08,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'mm',region:'آسيا',economy:82,tourism:77,safety:80,infrastructure:81,qualityOfLife:87,culture:86,nature:73,entertainment:80,totalScore:80.8},
  {id:'country-151',name:'ناميبيا',year:2026,rating:7.30,baseValue:550,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'na',region:'أفريقيا',economy:75,tourism:77,safety:75,infrastructure:67,qualityOfLife:71,culture:71,nature:69,entertainment:79,totalScore:73.0},
  {id:'country-152',name:'ناورو',year:2026,rating:7.58,baseValue:570,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'nr',region:'أوقيانوسيا',economy:78,tourism:75,safety:74,infrastructure:79,qualityOfLife:70,culture:81,nature:78,entertainment:71,totalScore:75.8},
  {id:'country-153',name:'نيبال',year:2026,rating:8.18,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'np',region:'آسيا',economy:87,tourism:82,safety:84,infrastructure:77,qualityOfLife:76,culture:79,nature:83,entertainment:86,totalScore:81.8},
  {id:'country-154',name:'نيكاراغوا',year:2026,rating:7.09,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ni',region:'أمريكا الوسطى',economy:72,tourism:67,safety:72,infrastructure:76,qualityOfLife:75,culture:70,nature:64,entertainment:71,totalScore:70.9},
  {id:'country-155',name:'النيجر',year:2026,rating:6.31,baseValue:470,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ne',region:'أفريقيا',economy:65,tourism:68,safety:62,infrastructure:69,qualityOfLife:62,culture:59,nature:63,entertainment:57,totalScore:63.1},
  {id:'country-156',name:'مقدونيا الشمالية',year:2026,rating:8.90,baseValue:670,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'mk',region:'أوروبا',economy:86,tourism:90,safety:83,infrastructure:95,qualityOfLife:87,culture:84,nature:94,entertainment:93,totalScore:89.0},
  {id:'country-157',name:'باكستان',year:2026,rating:8.16,baseValue:610,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'pk',region:'آسيا',economy:76,tourism:83,safety:73,infrastructure:83,qualityOfLife:80,culture:88,nature:89,entertainment:81,totalScore:81.6},
  {id:'country-158',name:'بالاو',year:2026,rating:8.58,baseValue:640,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'pw',region:'أوقيانوسيا',economy:87,tourism:84,safety:93,infrastructure:82,qualityOfLife:87,culture:87,nature:87,entertainment:79,totalScore:85.8},
  {id:'country-159',name:'بنما',year:2026,rating:6.81,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'pa',region:'أمريكا الوسطى',economy:67,tourism:66,safety:72,infrastructure:65,qualityOfLife:70,culture:64,nature:71,entertainment:70,totalScore:68.1},
  {id:'country-160',name:'بابوا غينيا الجديدة',year:2026,rating:8.85,baseValue:660,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'pg',region:'أوقيانوسيا',economy:91,tourism:83,safety:90,infrastructure:95,qualityOfLife:90,culture:90,nature:87,entertainment:82,totalScore:88.5},
  {id:'country-161',name:'باراغواي',year:2026,rating:7.78,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'py',region:'أمريكا الجنوبية',economy:84,tourism:83,safety:77,infrastructure:80,qualityOfLife:74,culture:72,nature:83,entertainment:69,totalScore:77.8},
  {id:'country-162',name:'رواندا',year:2026,rating:7.00,baseValue:520,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'rw',region:'أفريقيا',economy:70,tourism:69,safety:67,infrastructure:73,qualityOfLife:71,culture:73,nature:66,entertainment:71,totalScore:70.0},
  {id:'country-163',name:'سانت كيتس ونيفيس',year:2026,rating:6.88,baseValue:520,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'kn',region:'الكاريبي',economy:66,tourism:67,safety:64,infrastructure:74,qualityOfLife:66,culture:73,nature:68,entertainment:72,totalScore:68.8},
  {id:'country-164',name:'سانت لوسيا',year:2026,rating:6.80,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'lc',region:'الكاريبي',economy:65,tourism:64,safety:76,infrastructure:62,qualityOfLife:67,culture:66,nature:69,entertainment:75,totalScore:68.0},
  {id:'country-165',name:'سانت فنسنت والغرينادين',year:2026,rating:7.62,baseValue:570,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'vc',region:'الكاريبي',economy:70,tourism:79,safety:76,infrastructure:77,qualityOfLife:80,culture:74,nature:80,entertainment:74,totalScore:76.2},
  {id:'country-166',name:'ساموا',year:2026,rating:7.95,baseValue:600,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ws',region:'أوقيانوسيا',economy:81,tourism:72,safety:81,infrastructure:81,qualityOfLife:75,culture:85,nature:79,entertainment:82,totalScore:79.5},
  {id:'country-167',name:'سان مارينو',year:2026,rating:7.88,baseValue:590,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'sm',region:'أوروبا',economy:81,tourism:82,safety:86,infrastructure:74,qualityOfLife:70,culture:82,nature:82,entertainment:73,totalScore:78.8},
  {id:'country-168',name:'ساو تومي وبرينسيب',year:2026,rating:7.19,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'st',region:'أفريقيا',economy:73,tourism:66,safety:70,infrastructure:75,qualityOfLife:67,culture:74,nature:76,entertainment:74,totalScore:71.9},
  {id:'country-169',name:'السنغال',year:2026,rating:6.24,baseValue:470,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'sn',region:'أفريقيا',economy:57,tourism:67,safety:55,infrastructure:66,qualityOfLife:59,culture:70,nature:69,entertainment:56,totalScore:62.4},
  {id:'country-170',name:'سيراليون',year:2026,rating:6.44,baseValue:480,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'sl',region:'أفريقيا',economy:59,tourism:67,safety:62,infrastructure:71,qualityOfLife:57,culture:63,nature:72,entertainment:64,totalScore:64.4},
  {id:'country-171',name:'سلوفاكيا',year:2026,rating:8.49,baseValue:640,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'sk',region:'أوروبا',economy:91,tourism:80,safety:80,infrastructure:80,qualityOfLife:85,culture:89,nature:86,entertainment:88,totalScore:84.9},
  {id:'country-172',name:'جزر سليمان',year:2026,rating:8.02,baseValue:600,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'sb',region:'أوقيانوسيا',economy:84,tourism:83,safety:74,infrastructure:81,qualityOfLife:84,culture:80,nature:80,entertainment:76,totalScore:80.2},
  {id:'country-173',name:'الصومال',year:2026,rating:7.25,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'so',region:'أفريقيا',economy:76,tourism:78,safety:78,infrastructure:67,qualityOfLife:69,culture:69,nature:75,entertainment:68,totalScore:72.5},
  {id:'country-174',name:'جنوب السودان',year:2026,rating:7.18,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ss',region:'أفريقيا',economy:64,tourism:78,safety:63,infrastructure:69,qualityOfLife:71,culture:75,nature:78,entertainment:76,totalScore:71.8},
  {id:'country-175',name:'سريلانكا',year:2026,rating:8.21,baseValue:620,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'lk',region:'آسيا',economy:84,tourism:76,safety:83,infrastructure:86,qualityOfLife:76,culture:79,nature:90,entertainment:83,totalScore:82.1},
  {id:'country-176',name:'السودان',year:2026,rating:7.31,baseValue:550,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'sd',region:'أفريقيا',economy:78,tourism:77,safety:66,infrastructure:66,qualityOfLife:64,culture:76,nature:80,entertainment:78,totalScore:73.1},
  {id:'country-177',name:'سورينام',year:2026,rating:7.70,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'sr',region:'أمريكا الجنوبية',economy:71,tourism:82,safety:72,infrastructure:74,qualityOfLife:81,culture:75,nature:85,entertainment:76,totalScore:77.0},
  {id:'country-178',name:'سوريا',year:2026,rating:8.26,baseValue:620,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'sy',region:'آسيا / الشرق الأوسط',economy:87,tourism:84,safety:85,infrastructure:83,qualityOfLife:79,culture:77,nature:81,entertainment:85,totalScore:82.6},
  {id:'country-179',name:'طاجيكستان',year:2026,rating:7.84,baseValue:590,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'tj',region:'آسيا',economy:75,tourism:85,safety:78,infrastructure:79,qualityOfLife:79,culture:77,nature:73,entertainment:81,totalScore:78.4},
  {id:'country-180',name:'تيمور الشرقية',year:2026,rating:9.01,baseValue:680,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'tl',region:'آسيا',economy:94,tourism:88,safety:87,infrastructure:87,qualityOfLife:93,culture:90,nature:89,entertainment:93,totalScore:90.1},
  {id:'country-181',name:'توغو',year:2026,rating:7.22,baseValue:540,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'tg',region:'أفريقيا',economy:66,tourism:72,safety:68,infrastructure:79,qualityOfLife:76,culture:81,nature:65,entertainment:71,totalScore:72.2},
  {id:'country-182',name:'تونغا',year:2026,rating:8.46,baseValue:630,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'to',region:'أوقيانوسيا',economy:83,tourism:83,safety:83,infrastructure:84,qualityOfLife:83,culture:80,nature:94,entertainment:87,totalScore:84.6},
  {id:'country-183',name:'ترينيداد وتوباغو',year:2026,rating:6.64,baseValue:500,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'tt',region:'الكاريبي',economy:59,tourism:63,safety:70,infrastructure:60,qualityOfLife:71,culture:70,nature:66,entertainment:72,totalScore:66.4},
  {id:'country-184',name:'تركمانستان',year:2026,rating:8.42,baseValue:630,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'tm',region:'آسيا',economy:80,tourism:85,safety:90,infrastructure:78,qualityOfLife:76,culture:87,nature:87,entertainment:91,totalScore:84.2},
  {id:'country-185',name:'توفالو',year:2026,rating:7.46,baseValue:560,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'tv',region:'أوقيانوسيا',economy:70,tourism:70,safety:80,infrastructure:71,qualityOfLife:71,culture:78,nature:73,entertainment:84,totalScore:74.6},
  {id:'country-186',name:'أوغندا',year:2026,rating:6.58,baseValue:490,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'ug',region:'أفريقيا',economy:71,tourism:65,safety:66,infrastructure:72,qualityOfLife:62,culture:62,nature:65,entertainment:63,totalScore:65.8},
  {id:'country-187',name:'أوكرانيا',year:2026,rating:8.79,baseValue:660,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'ua',region:'أوروبا',economy:85,tourism:94,safety:88,infrastructure:80,qualityOfLife:93,culture:85,nature:92,entertainment:86,totalScore:87.9},
  {id:'country-188',name:'أوزبكستان',year:2026,rating:7.91,baseValue:590,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'uz',region:'آسيا',economy:81,tourism:80,safety:82,infrastructure:86,qualityOfLife:83,culture:74,nature:72,entertainment:75,totalScore:79.1},
  {id:'country-189',name:'فانواتو',year:2026,rating:7.64,baseValue:570,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'vu',region:'أوقيانوسيا',economy:81,tourism:77,safety:76,infrastructure:84,qualityOfLife:79,culture:75,nature:69,entertainment:70,totalScore:76.4},
  {id:'country-190',name:'فنزويلا',year:2026,rating:7.68,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ve',region:'أمريكا الجنوبية',economy:74,tourism:83,safety:72,infrastructure:84,qualityOfLife:81,culture:74,nature:75,entertainment:71,totalScore:76.8},
  {id:'country-191',name:'اليمن',year:2026,rating:8.24,baseValue:620,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ye',region:'آسيا / الشرق الأوسط',economy:74,tourism:86,safety:81,infrastructure:86,qualityOfLife:84,culture:86,nature:88,entertainment:74,totalScore:82.4},
  {id:'country-192',name:'زامبيا',year:2026,rating:6.74,baseValue:510,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'zm',region:'أفريقيا',economy:72,tourism:63,safety:69,infrastructure:62,qualityOfLife:71,culture:66,nature:65,entertainment:71,totalScore:67.4},
  {id:'country-193',name:'زيمبابوي',year:2026,rating:7.01,baseValue:530,genre:'دولة',rarity:'عادي',rarityClass:'common',img:'',countryCode:'zw',region:'أفريقيا',economy:74,tourism:70,safety:71,infrastructure:67,qualityOfLife:64,culture:71,nature:67,entertainment:77,totalScore:70.1},
  {id:'country-194',name:'فلسطين',year:2026,rating:7.71,baseValue:580,genre:'دولة',rarity:'مميز',rarityClass:'special',img:'',countryCode:'ps',region:'آسيا / الشرق الأوسط',economy:75,tourism:74,safety:78,infrastructure:85,qualityOfLife:86,culture:76,nature:71,entertainment:72,totalScore:77.1},
  {id:'country-195',name:'الفاتيكان',year:2026,rating:8.85,baseValue:660,genre:'دولة',rarity:'نادر',rarityClass:'rare',img:'',countryCode:'va',region:'أوروبا',economy:93,tourism:83,safety:83,infrastructure:96,qualityOfLife:83,culture:87,nature:91,entertainment:92,totalScore:88.5},
];

// ISO 3166-1 alpha-2 codes used by FlagCDN for the country flags.
const countryCodes = {
  'الإمارات العربية المتحدة':'ae','السعودية':'sa','قطر':'qa','الكويت':'kw','البحرين':'bh','عُمان':'om',
  'اليابان':'jp','كوريا الجنوبية':'kr','سنغافورة':'sg','الصين':'cn','الهند':'in','إندونيسيا':'id','تايلاند':'th','ماليزيا':'my',
  'تركيا':'tr','إسرائيل':'il','أستراليا':'au','نيوزيلندا':'nz','الولايات المتحدة':'us','كندا':'ca','المكسيك':'mx',
  'البرازيل':'br','الأرجنتين':'ar','تشيلي':'cl','كولومبيا':'co','بيرو':'pe','أوروغواي':'uy',
  'فرنسا':'fr','إيطاليا':'it','إسبانيا':'es','ألمانيا':'de','المملكة المتحدة':'gb','سويسرا':'ch','النمسا':'at','هولندا':'nl','بلجيكا':'be',
  'النرويج':'no','السويد':'se','الدنمارك':'dk','فنلندا':'fi','آيسلندا':'is','أيرلندا':'ie','البرتغال':'pt','اليونان':'gr',
  'التشيك':'cz','بولندا':'pl','المجر':'hu','رومانيا':'ro','كرواتيا':'hr','سلوفينيا':'si','صربيا':'rs','روسيا':'ru',
  'جنوب أفريقيا':'za','مصر':'eg','المغرب':'ma','تونس':'tn','الجزائر':'dz','كينيا':'ke','نيجيريا':'ng','إثيوبيا':'et',
  'تنزانيا':'tz','موريشيوس':'mu','سيشل':'sc','فيتنام':'vn','الفلبين':'ph'
};
countries.forEach(c=>{ const code=(c.countryCode||countryCodes[c.name]||'').toLowerCase(); if(code){ c.countryCode=code; c.img=`https://flagcdn.io/flags/4x3/${code}.svg`; } });

const rooms=new Map(); function code(){let s;do{s='MZ'+Math.floor(1000+Math.random()*9000)}while(rooms.has(s));return s}
function pub(r){let current=null;if(r.film){current={...r.film,value:undefined};delete current.rating;if(r.category==='countries'){for(const k of ['economy','tourism','safety','infrastructure','qualityOfLife','culture','nature','entertainment','totalScore'])delete current[k];}}return {phase:r.phase,category:r.category,players:r.players.map(p=>({id:p.id,userId:p.userId,name:p.name,balance:p.balance,spent:p.spent,films:p.films,active:p.active,selectedFilmId:p.selectedFilmId,cards:p.cards||{double:1,freeze:1,reveal:1},frozenUntil:p.frozenUntil||0,doubleNext:!!p.doubleNext})),round:r.round,rounds:r.rounds,film:current,highest:r.highest,leader:r.leader,current:r.current,turnEndsAt:r.turnEndsAt,history:r.history,selectionTurnId:r.selectionTurnId,selectionTurnUserId:r.selectionTurnUserId,finalRanked:r.finalRanked,finalHistory:r.finalHistory||[]}};
function broadcast(r){io.to(r.room).emit('state',pub(r));}
function getR(s){return rooms.get(s.room)}
function startAuction(r){if(r.round>=r.rounds){r.phase='selection';const firstPicker=r.players.find(p=>p.films.length);r.selectionTurnId=firstPicker?.id||null;r.selectionTurnUserId=firstPicker?.userId||null;r.players.forEach(p=>p.selectedFilmId=null);broadcast(r);return}const f={...r.pool[r.round++]};f.value=Math.max(30,Math.round(f.baseValue*(0.82+Math.random()*0.36)/10)*10);r.film=f;r.highest=0;r.leader=-1;r.players.forEach(p=>{p.active=true;p.frozenUntil=0;p.doubleNext=false;p.loan=null;});r.current=0;r.turnEndsAt=Date.now()+15000;broadcast(r);setTimeout(()=>turnTimeout(r.room),15050)}
function nextActive(r,from){for(let k=1;k<=r.players.length;k++){const i=(from+k)%r.players.length;const p=r.players[i];if(p.active&&i!==r.leader)return i}return -1}
function turnTimeout(room){const r=rooms.get(room);if(!r||r.phase!=='auction'||Date.now()<r.turnEndsAt-100)return;const p=r.players[r.current];if(!p)return;if(p.frozenUntil&&p.frozenUntil>Date.now()){setTimeout(()=>turnTimeout(room),Math.max(250,p.frozenUntil-Date.now()+50));return;}actionWithdraw(r,p.id)}
function restartTimer(r){r.turnEndsAt=Date.now()+15000;const room=r.room;setTimeout(()=>turnTimeout(room),15050);}
function actionWithdraw(r,id){const i=r.players.findIndex(p=>p.id===id);if(i<0||r.phase!=='auction'||i!==r.current||i===r.leader||!r.players[i].active)return;r.players[i].active=false;const others=r.players.filter((p,j)=>p.active&&j!==r.leader).length;if(others===0){if(r.leader>=0)sell(r);else noSale(r);return}r.current=nextActive(r,i);if(r.current<0){if(r.leader>=0)sell(r);else noSale(r);return}restartTimer(r);broadcast(r)}
function sell(r){
  const p=r.players[r.leader];
  const loanDiscount=p?.loan ? Math.max(0,Number(p.loan.base)||0) : 0;
  const paid=Math.max(0,r.highest-loanDiscount);
  const saving=r.film.value-paid;
  p.balance=Math.max(0,p.balance-paid);
  p.spent+=paid;
  p.films.push({...r.film,price:paid,saving});
  r.history.push({film:r.film.name,player:p.name,price:paid});
  if(p.loan){
    io.to(p.id).emit('loanWon',{amount:paid,discount:loanDiscount,message:`💰 فزت بالقرض — دُفع ${paid} د.ك بدل ${r.highest} د.ك.`});
    p.loan=null;
  }
  r.phase='auction';startAuction(r)
}
function noSale(r){r.history.push({film:r.film.name,player:'لم يُبع',price:0});r.phase='auction';startAuction(r)}
function finalScore(f){
  if(f?.category==='countries' || f?.economy!==undefined){return Number(f.totalScore||0);}
  const c=cinema[f.name]||{fame:f.fame||50,awards:f.awards||0};
  return c.fame*.45+(f.rating/10*100)*.35+Math.min(c.awards*5,25)*.2*4;
}
async function makeFinal(r){
  const valid=r.players.filter(p=>p.films.some(f=>f.id===p.selectedFilmId));
  r.finalRanked=valid.map(p=>{
    const f=p.films.find(x=>x.id===p.selectedFilmId);
    if(r.category==='countries'){
      return {player:p.name,film:f,countryMetrics:{economy:f.economy,tourism:f.tourism,safety:f.safety,infrastructure:f.infrastructure,qualityOfLife:f.qualityOfLife,culture:f.culture,nature:f.nature,entertainment:f.entertainment},total:Number(f.totalScore||0)};
    }
    const c=cinema[f.name]||{fame:f.fame||50,awards:f.awards||0,awardText:'بيانات الشهرة العالمية'};
    return {player:p.name,film:f,fame:c.fame,awards:c.awards,awardText:c.awardText,total:finalScore(f)};
  }).sort((a,b)=>b.total-a.total);
  r.phase='final';
  await saveGameResults(r);
  broadcast(r);
}
async function saveGameResults(r){
  if(!supabase||!r.finalRanked?.length||r.resultsSaved)return;
  r.resultsSaved=true;
  const rows=r.finalRanked.map((x,i)=>{const p=r.players.find(p=>p.name===x.player && p.films.some(f=>f.id===x.film.id));return {game_id:r.gameId,user_id:p?.userId||null,username:x.player,category:r.category,rank:i+1,item_name:x.film.name,item_id:x.film.id,total_score:Number(x.total.toFixed(1)),spent:Number((p?.spent||0).toFixed(1)),created_at:new Date().toISOString()};}).filter(x=>x.user_id);
  if(rows.length){const {error}=await supabase.from('game_results').insert(rows);if(error){r.resultsSaved=false;console.error('game_results insert failed',error);}}
}


function selectionForUser(r,userId,index){
  if(!r) return {ok:false,error:'الغرفة غير موجودة أو انتهت.'};
  if(r.phase!=='selection') return {ok:false,error:'مرحلة اختيار المواجهة لم تبدأ بعد.'};
  const uid=String(userId||'');
  if(!uid) return {ok:false,error:'انتهت جلسة الحساب. سجّل الدخول من جديد.'};
  const matches=r.players.filter(x=>String(x.userId)===uid);
  if(matches.length>1) return {ok:false,error:'هذا الحساب مستخدم لأكثر من لاعب في الغرفة. استخدم حسابًا مختلفًا لكل لاعب.'};
  const p=matches[0];
  if(!p) return {ok:false,error:'لم يتم العثور على لاعبك في الغرفة. أعد الدخول للغرفة.'};
  const turnOk=(r.selectionTurnUserId && String(r.selectionTurnUserId)===String(p.userId)) || (r.selectionTurnId && String(r.selectionTurnId)===String(p.id));
  if(!turnOk) return {ok:false,error:'ليس دورك لاختيار الفيلم الآن.'};
  const idx=Number(index);
  if(!Number.isInteger(idx)) return {ok:false,error:'اختيار غير صالح.'};
  const f=p.films?.[idx];
  if(!f) return {ok:false,error:'الفيلم المختار غير موجود.'};
  if(p.selectedFilmId) return {ok:false,error:'لقد اخترت فيلمًا بالفعل.'};
  p.selectedFilmId=f.id||`${p.userId}-${idx}-${f.name}`;
  const next=r.players.find(x=>x.films.length&&!x.selectedFilmId);
  r.selectionTurnId=next?.id||null;
  r.selectionTurnUserId=next?.userId||null;
  return {ok:true,film:f.name,nextUserId:next?.userId||null,finished:!next};
}

// Mobile-safe HTTP fallback for the final movie selection.
// This avoids relying on a Socket.IO acknowledgement callback on some mobile browsers.
app.post('/api/game/select-film',async(req,res)=>{
  try{
    if(!authReady(res))return;
    const user=await userFromRequest(req);
    if(!user)return res.status(401).json({ok:false,error:'انتهت جلسة الحساب. سجّل الدخول من جديد.'});
    const roomCode=String(req.body?.room||'').trim().toUpperCase();
    const r=rooms.get(roomCode);
    const result=selectionForUser(r,user.id,req.body?.index);
    if(!result.ok)return res.status(400).json(result);
    if(result.finished){
      await makeFinal(r);
    }else{
      broadcast(r);
    }
    return res.json({ok:true,film:result.film,finished:result.finished});
  }catch(e){
    console.error('HTTP select-film failed',e);
    return res.status(500).json({ok:false,error:'حدث خطأ أثناء اختيار الفيلم. حاول مرة أخرى.'});
  }
});

io.use(async(socket,next)=>{
  try{if(!supabase)return next(new Error('accounts_not_configured'));const token=parseCookies(socket.handshake.headers.cookie||'').mazad_session;if(!token)return next(new Error('login_required'));const {data,error}=await supabase.from('sessions').select('user_id,expires_at,users(id,username)').eq('token_hash',tokenHash(token)).maybeSingle();if(error||!data||new Date(data.expires_at)<=new Date())return next(new Error('login_required'));const u=Array.isArray(data.users)?data.users[0]:data.users;if(!u?.id)return next(new Error('login_required'));socket.user=u;next();}catch(e){next(new Error('auth_failed'));}
});
io.on('connection',socket=>{socket.on('createRoom',d=>{const category=['films','celebrities','countries'].includes(d.category)?d.category:'films';const source=category==='celebrities'?celebrities:(category==='countries'?countries:films);const r={room:code(),phase:'lobby',category,hostId:socket.id,budget:Math.max(20,+d.budget||500),playerCount:Math.min(6,Math.max(2,+d.playerCount||4)),rounds:Math.min(source.length,Math.min(100,Math.max(2,Math.floor(+d.rounds||8)))),players:[{id:socket.id,userId:socket.user.id,name:socket.user.username,balance:0,spent:0,films:[],active:true,cards:{double:1,freeze:1,reveal:1},frozenUntil:0,doubleNext:false,loan:null}],pool:[],round:0,history:[],gameId:crypto.randomUUID(),resultsSaved:false};r.players[0].balance=r.budget;rooms.set(r.room,r);socket.join(r.room);socket.emit('roomCreated',{room:r.room,state:pub(r)})});
socket.on('requestState',d=>{const r=getR(d);if(r)socket.emit('state',pub(r));});
socket.on('joinRoom',d=>{const r=rooms.get(String(d.room||'').toUpperCase());if(!r)return socket.emit('errorMsg','الغرفة غير موجودة.');if(r.phase!=='lobby')return socket.emit('errorMsg','اللعبة بدأت بالفعل.');if(r.players.length>=r.playerCount)return socket.emit('errorMsg','الغرفة ممتلئة.');if(r.players.some(p=>String(p.userId)===String(socket.user.id)))return socket.emit('errorMsg','هذا الحساب موجود بالفعل في الغرفة. استخدم حسابًا مختلفًا لكل لاعب.');r.players.push({id:socket.id,userId:socket.user.id,name:socket.user.username,balance:r.budget,spent:0,films:[],active:true,cards:{double:1,freeze:1,reveal:1},frozenUntil:0,doubleNext:false,loan:null});socket.join(r.room);socket.emit('joined',{room:r.room,state:pub(r)});broadcast(r)});
socket.on('startGame',d=>{const r=getR(d);if(!r||socket.id!==r.hostId||r.phase!=='lobby')return;if(r.players.length<2)return socket.emit('errorMsg','يجب دخول لاعبين على الأقل.');const source=r.category==='celebrities'?celebrities:(r.category==='countries'?countries:films);r.pool=source.slice().sort(()=>Math.random()-.5).slice(0,r.rounds);r.phase='auction';r.round=0;startAuction(r)});
socket.on('bid',d=>{
  try{
    const r=getR(d);
    if(!r) return socket.emit('errorMsg','الغرفة غير موجودة أو انتهت.');
    if(r.phase!=='auction') return socket.emit('errorMsg','المزاد ليس في مرحلة المزايدة الآن.');
    const current=r.players[r.current];
    if(!current) return socket.emit('errorMsg','لا يوجد دور مزايدة حالي.');
    if(!socket.user?.id) return socket.emit('errorMsg','انتهت جلسة الحساب. سجّل الدخول من جديد.');
    if(String(current.userId)!==String(socket.user.id)) return socket.emit('errorMsg','ليس دورك الآن — انتظر حتى يظهر دورك.');
    if(r.current===r.leader) return socket.emit('errorMsg','أنت أعلى مزايد حاليًا ولا يمكنك المزايدة على نفسك.');
    if(!current.active) return socket.emit('errorMsg','لقد انسحبت من هذه الجولة.');
    if(current.frozenUntil&&current.frozenUntil>Date.now()) return socket.emit('errorMsg',`أنت مجمّد حتى ${Math.ceil((current.frozenUntil-Date.now())/1000)} ثوانٍ.`);
    const v=Number(d?.value);
    if(!Number.isInteger(v)||v<10||v>500||v%10!==0) return socket.emit('errorMsg','المزايدة يجب أن تكون من 10 إلى 500 وبمضاعفات 10.');

    const usingLoan=!!current.doubleNext;
    const effectiveV=usingLoan?v*2:v;
    const np=r.highest+effectiveV;
    // قرض يسمح لك بالمزايدة بالدبل حتى لو كان رصيدك أقل من قيمة الدبل.
    // المبلغ الحقيقي/العقوبة تتم تسويتها عند الفوز أو عند خسارة المتصدر.
    if(!usingLoan && np>current.balance) return socket.emit('errorMsg',`رصيدك لا يكفي. المطلوب ${np} د.ك، ورصيدك ${current.balance} د.ك.`);

    // إذا كان المتصدر السابق قد استخدم بطاقة قرض، فقد خسر الآن:
    // نخصم قيمة الدبل منه، أو كامل ما تبقى في محفظته إذا كان أقل.
    const previousLeaderIndex=r.leader;
    if(previousLeaderIndex>=0){
      const previousLeader=r.players[previousLeaderIndex];
      if(previousLeader?.loan){
        const penalty=Math.max(0,Number(previousLeader.loan.penalty)||0);
        const charged=Math.min(Math.max(0,previousLeader.balance),penalty);
        previousLeader.balance-=charged;
        previousLeader.loan=null;
        io.to(previousLeader.id).emit('loanPenalty',{penalty,charged,message:`💸 خسرت بطاقة القرض — خُصم ${charged} د.ك من محفظتك.`});
      }
    }

    r.leader=r.current;
    r.highest=np;
    if(usingLoan){
      current.doubleNext=false;
      current.loan={base:v,penalty:v*2};
    }
    r.current=nextActive(r,r.current);
    socket.emit('bidAccepted',{amount:np,loan:usingLoan,base:v});
    if(r.current<0) sell(r); else { restartTimer(r); broadcast(r); }
  }catch(e){console.error('bid handler failed',e);socket.emit('errorMsg','حدث خطأ أثناء المزايدة. حاول مرة أخرى.');}
});
socket.on('useCard',(d,ack)=>{
  const reply=(x)=>{try{if(typeof ack==='function')ack(x)}catch(e){}};
  try{
    const r=getR(d); if(!r)return reply({ok:false,error:'الغرفة غير موجودة.'});
    if(r.phase!=='auction')return reply({ok:false,error:'البطاقات تعمل أثناء المزاد فقط.'});
    const p=r.players.find(x=>String(x.userId)===String(socket.user?.id));
    if(!p)return reply({ok:false,error:'لم يتم العثور على لاعبك في الغرفة.'});
    p.cards=p.cards||{double:1,freeze:1,reveal:1};
    const type=String(d?.type||'');
    if(!['double','freeze','reveal'].includes(type))return reply({ok:false,error:'بطاقة غير معروفة.'});
    if(Number(p.cards[type]||0)<=0)return reply({ok:false,error:'لا تملك هذه البطاقة.'});
    if(type==='double'){
      if(p.doubleNext)return reply({ok:false,error:'بطاقة القرض مفعّلة بالفعل.'});
      p.cards.double--;p.doubleNext=true;
      broadcast(r);socket.emit('cardUsed',{type,message:'💰 قرض: مزايدتك القادمة تتضاعف. إذا فزت تدفع الزيادة الأصلية، وإذا خسرت تُخصم قيمة الدبل من محفظتك.'});return reply({ok:true});
    }
    if(type==='reveal'){
      if(!r.film)return reply({ok:false,error:'لا يوجد عنصر حالي.'});
      p.cards.reveal--;
      const rating=Number(r.film.rating);
      broadcast(r);
      socket.emit('cardRevealResult',{itemId:r.film.id,name:r.film.name,rating,category:r.category});
      return reply({ok:true,rating});
    }
    const targetIndex=Number(d?.target);
    if(!Number.isInteger(targetIndex)||targetIndex<0||targetIndex>=r.players.length)return reply({ok:false,error:'اختر لاعبًا صحيحًا.'});
    const target=r.players[targetIndex];
    if(!target||target.userId===p.userId||!target.active)return reply({ok:false,error:'لا يمكنك تجميد هذا اللاعب.'});
    if(targetIndex===r.leader)return reply({ok:false,error:'أعلى مزايد لا يحتاج إلى تجميد.'});
    p.cards.freeze--;target.frozenUntil=Date.now()+10000;
    broadcast(r);socket.emit('cardUsed',{type,message:`🛑 تم تجميد ${target.name} لمدة 10 ثوانٍ.`});
    return reply({ok:true});
  }catch(e){console.error('useCard handler failed',e);socket.emit('errorMsg','تعذر استخدام البطاقة.');return reply({ok:false,error:'تعذر استخدام البطاقة.'});}
});
socket.on('withdraw',d=>{const r=getR(d);if(!r)return socket.emit('errorMsg','الغرفة غير موجودة.');const p=r.players.find(x=>x.userId===socket.user?.id);if(!p)return socket.emit('errorMsg','لم يتم العثور على لاعبك في هذه الغرفة.');actionWithdraw(r,p.id)});
socket.on('selectFilm',(d,ack)=>{
  const reply=(payload)=>{try{if(typeof ack==='function')ack(payload);}catch(e){}}
  try{
    const result=selectionForUser(getR(d),socket.user?.id,d?.index);
    if(!result.ok){socket.emit('selectionError',{error:result.error});return reply({ok:false,error:result.error});}
    if(result.finished){makeFinal(r).catch(e=>console.error('final build failed',e));}else{broadcast(r);} socket.emit('selectionAccepted',{film:result.film,finished:result.finished});
    if(result.finished) void makeFinal(getR(d)); else broadcast(getR(d));
    reply({ok:true,film:result.film,finished:result.finished});
  }catch(e){
    console.error('selectFilm handler failed',e);
    const error='حدث خطأ أثناء اختيار الفيلم. حاول مرة أخرى.';
    socket.emit('selectionError',{error});
    reply({ok:false,error});
  }
});
socket.on('disconnect',()=>{for(const r of rooms.values()){const i=r.players.findIndex(p=>p.id===socket.id);if(i>=0&&r.phase!=='final'){const name=r.players[i].name;r.players.splice(i,1);if(r.players.length<2){r.phase='lobby'}if(r.hostId===socket.id&&r.players[0])r.hostId=r.players[0].id;broadcast(r);io.to(r.room).emit('disconnectedPlayer',name);}}});});
const PORT=process.env.PORT||3000;server.listen(PORT,'0.0.0.0',()=>console.log(`Mazad Online running on http://localhost:${PORT}`));