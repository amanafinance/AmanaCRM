// Тестовая база: 150 клиентов, 200 договоров с графиками, оплаты с операциями кассы, 2 счёта,
// учредитель и инвестор с вкладами 3 месяца назад. Суммы согласованы: касса = сумма операций.
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,writeBatch,Timestamp} from 'firebase/firestore';

export const PROJECT='amana-crm-16033';
const OPEN="rules_version='2';service cloud.firestore{match /databases/{d}/documents{match /{p=**}{allow read,write: if request.auth!=null;}}}";

export async function seed(opts={}){
  const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8085,rules:OPEN}});
  await env.clearFirestore();
  let n=0;
  if(!opts.empty)await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();let b=writeBatch(db);
    const put=async(p,d)=>{b.set(doc(db,p),d);if(++n%400===0){await b.commit();b=writeBatch(db);}};
    const now=new Date(),f=d=>('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear();
    for(let j=0;j<150;j++)await put('persons/P'+j,{name:'Клиент '+j,phones:['8928'+(1000000+j)],addr:'',note:'',no:'К-'+String(j+1).padStart(4,'0')});
    await put('settings/pcounter',{lastId:150});
    const bal={w1:0,w2:0};
    for(let i=0;i<200;i++){
      const st=new Date(now.getFullYear(),now.getMonth()-(i%12)-1,5),price=50000+(i%10)*5000,cost=Math.round(price*0.7),prepay=5000,mo=6,step=Math.round((price-prepay)/mo);
      const c={name:'Клиент '+(i%150),clientPid:'P'+(i%150),guarantors:i%3?[]:[{name:'Клиент '+((i+1)%150),pid:'P'+((i+1)%150)}],phones:['8928'+(1000000+(i%150))],
        product:'Товар '+(i%7),partner:'Сторонний',price,cost,prepay,months:mo,date:f(st),contractId:String(i+1).padStart(5,'0'),createdAt:Timestamp.fromDate(st)};
      for(let m=1;m<=12;m++){const d=new Date(st.getFullYear(),st.getMonth()+m,5);c['размер'+m]=m<=mo?(m<mo?step:price-prepay-step*(mo-1)):0;c['дата'+m]=m<=mo?f(d):'';}
      await put('clients/c'+i,c);
      for(let m=1;m<=5;m++){
        const d=new Date(st.getFullYear(),st.getMonth()+m,4);if(d>now)break;const w=m%2?'w1':'w2',a=c['размер'+m];
        await put('payments/p'+i+'_'+m,{clientId:'c'+i,contractId:c.contractId,name:c.name,amount:a,type:'payment',typeLabel:'Ежемес. платеж',payType:w==='w1'?'Наличные':'Сбер',wallet:w,kassaOpId:'k'+i+'_'+m,date:Timestamp.fromDate(d),dateStr:f(d)});
        await put('kassaOps/k'+i+'_'+m,{type:'payment_in',amount:a,wallet:w,walletName:w==='w1'?'Наличные':'Сбер',desc:'Оплата от '+c.name+' (№'+c.contractId+')',date:Timestamp.fromDate(d),dateStr:f(d),auto:true,refType:'client',refId:'c'+i,paymentId:'p'+i+'_'+m});
        bal[w]+=a;
      }
    }
    const m1=new Date(now.getFullYear(),now.getMonth(),1,10);
    await put('kassaOps/manual1',{type:'opex',amount:1000,wallet:'w1',walletName:'Наличные',desc:'Тест',date:Timestamp.fromDate(m1),dateStr:f(m1),auto:false});bal.w1-=1000;
    if(opts.investors!==false){
      const m3=new Date(now.getFullYear(),now.getMonth()-3,1,12);
      await put('investors/INV0',{name:'Учредитель',role:'founder',archived:false,createdAt:Timestamp.fromDate(m3)});
      await put('investors/INV1',{name:'Инвестор',role:'investor',archived:false,createdAt:Timestamp.fromDate(m3)});
      await put('invOps/dep0',{invId:'INV0',invName:'Учредитель',type:'deposit',amount:3000000,date:Timestamp.fromDate(m3),dateStr:f(m3),auto:false,kassaOpId:'kinv0',createdAt:Timestamp.fromDate(m3)});
      await put('invOps/dep1',{invId:'INV1',invName:'Инвестор',type:'deposit',amount:1000000,pct:50,endDate:null,date:Timestamp.fromDate(m3),dateStr:f(m3),auto:false,kassaOpId:'kinv1',createdAt:Timestamp.fromDate(m3)});
      await put('kassaOps/kinv0',{type:'inv_in',amount:3000000,wallet:'w1',walletName:'Наличные',desc:'Вклад в пул: Учредитель',date:Timestamp.fromDate(m3),dateStr:f(m3),auto:true,refType:'investor',refId:'INV0',invOpId:'dep0'});
      await put('kassaOps/kinv1',{type:'inv_in',amount:1000000,wallet:'w2',walletName:'Сбер',desc:'Вклад в пул: Инвестор',date:Timestamp.fromDate(m3),dateStr:f(m3),auto:true,refType:'investor',refId:'INV1',invOpId:'dep1'});
      bal.w1+=3000000;bal.w2+=1000000;
    }
    await put('wallets/w1',{name:'Наличные',type:'cash',balance:bal.w1,isDefault:true});
    await put('wallets/w2',{name:'Сбер',type:'card',balance:bal.w2});
    await put('settings/counter',{lastId:200});
    await b.commit();
  });
  await env.cleanup();
  return n;
}
