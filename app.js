'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'cn-budget-cycle-pwa-v1';
  const DB_NAME = 'cn-budget-cycle-offline-db';
  const DB_VERSION = 1;
  const ONE_DAY = 86400000;
  const seed = () => ({
    schemaVersion: 2,
    budgets: {},
    income: {},
    records: {},
    assetRecords: {}
  });
  let data = seed();
  let offset = 0;
  let dirty = false;
  let writeQueue = Promise.resolve();
  let storeMode = 'indexeddb';
  let today = getChinaDate();

  const key = d => d.toISOString().slice(0, 10);
  const date = (y, m, d) => new Date(Date.UTC(y, m, d));
  const addDays = (d, n) => new Date(d.getTime() + n * ONE_DAY);
  const fmt = (n, decimals = 2) => '¥' + Number(n).toLocaleString('zh-CN', {minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const daysBetween = (a,b) => Math.round((b-a)/ONE_DAY);
  const cnDate = d => `${d.getUTCFullYear()}年${d.getUTCMonth()+1}月${d.getUTCDate()}日`;
  const shortDate = d => `${d.getUTCMonth()+1}月${d.getUTCDate()}日`;
  const isAmount = n => Number.isFinite(n) && n >= 0 && n <= 99999999;
  function getChinaDate(){
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date());
    const x={};for(const p of parts) if(p.type!=='literal') x[p.type]=Number(p.value);
    return new Date(Date.UTC(x.year,x.month-1,x.day));
  }
  function cycleStart(d){return date(d.getUTCFullYear(), d.getUTCMonth() + (d.getUTCDate()<15 ? -1 : 0), 15)}
  function shifted(d,n){return date(d.getUTCFullYear(),d.getUTCMonth()+n,15)}
  function currentCycle(){return cycleStart(today)}
  function selectedCycle(){return shifted(currentCycle(),offset)}
  function selectedId(){return key(selectedCycle())}
  function recordOf(id){return Object.prototype.hasOwnProperty.call(data.records,id) ? data.records[id] : null}
  function budgetOf(id){return Object.prototype.hasOwnProperty.call(data.budgets,id) ? data.budgets[id] : 6000}
  function showMessage(t){$('saveMessage').textContent=t;if(!$('assetsPanel').hidden)$('assetMessage').textContent=t;}
  function trimCurrency(n){return (n < 0 ? '−' : '') + fmt(Math.abs(n))}

  function openDB(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings')};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error || new Error('DB open failed'));
      req.onblocked=()=>reject(new Error('DB blocked'));
    });
  }
  async function idbRead(){
    const db=await openDB();
    try {return await new Promise((resolve,reject)=>{
      const tx=db.transaction('settings','readonly');const req=tx.objectStore('settings').get('state');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    })}finally{db.close()}
  }
  async function idbWrite(obj){
    const db=await openDB();
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(obj,'state');
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    })}finally{db.close()}
  }
  function clean(input){
    const res={schemaVersion:2,budgets:{},income:{},records:{},assetRecords:{}};
    if(!input||typeof input !== 'object'||![1,2].includes(input.schemaVersion))throw new Error('不支持该备份版本');
    for(const [id,val] of Object.entries(input.budgets||{})){
      if(/^\d{4}-\d{2}-15$/.test(id)&&Number.isFinite(Number(val))&&Number(val)>0&&Number(val)<=99999999)res.budgets[id]=round(Number(val));
    }
    for(const [id,val] of Object.entries(input.income||{})){
      if(/^\d{4}-\d{2}-15$/.test(id)&&isAmount(Number(val)))res.income[id]=round(Number(val));
    }
    for(const [id,r] of Object.entries(input.records||{})){
      if(!/^\d{4}-\d{2}-15$/.test(id)||!r||typeof r!=='object'||!isAmount(Number(r.total)))continue;
      const y=Number(id.slice(0,4)),m=Number(id.slice(5,7))-1;
      if(key(date(y,m,15))!==id)continue;
      const end=key(addDays(shifted(date(y,m,15),1),-1));
      const asOf=typeof r.asOf==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.asOf)&&r.asOf>=id&&r.asOf<=end?r.asOf:end;
      res.records[id]={total:round(Number(r.total)),asOf,source: String(r.source||'手动更新').slice(0,100)};
    }
    for(const [day,r] of Object.entries(input.assetRecords||{})){
      if(!isSnapshotDate(day)||!r||typeof r!=='object')continue;
      if(!isAmount(r.bank)||!isSignedAmount(r.okx)||!isSignedAmount(r.futu)||!isAmount(r.debt))continue;
      res.assetRecords[day]={bank:round(r.bank),okx:round(r.okx),futu:round(r.futu),debt:round(r.debt)};
    }
    return res;
  }
  async function initializeStorage(){
    try{
      const existing=await idbRead();
      if(existing)data=clean(existing);else await idbWrite(data);
      storeMode='indexeddb';
    } catch (e) {
      storeMode='localstorage';
      try{
        const s=localStorage.getItem(STORAGE_KEY);
        if(s)data=clean(JSON.parse(s));
        else localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
      }catch(e2){storeMode='session';showMessage('本机存储不可用，每次更新后请手动导出备份')}
    }
  }
  function persist(){
    const state=structuredClone(data);
    writeQueue=writeQueue.catch(()=>{}).then(async()=>{
      if(storeMode==='indexeddb'){
        try{await idbWrite(state);return true;}catch(e){storeMode='localstorage'}
      }
      if(storeMode==='localstorage'){
        try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}catch(e){storeMode='session'}
      }
      return false;
    });
    return writeQueue;
  }
  function renderHistory(){
    const entries=Object.entries(data.records).filter(([k])=>k<=selectedId()).sort(([a],[b])=>b.localeCompare(a));
    $('historyCount').textContent='共'+entries.length+'期';
    $('historyList').replaceChildren();
    if(!entries.length){const p=document.createElement('div');p.className='empty';p.textContent='暂无记录';$('historyList').appendChild(p);return}
    for(const [k,r] of entries.slice(0,12)){
      const row=document.createElement('div');row.className='history-item';
      const div=document.createElement('div');
      const title=document.createElement('div');title.className='history-name';
      const start=date(Number(k.slice(0,4)),Number(k.slice(5,7))-1,15);
      title.textContent=(start.getUTCFullYear())+'年'+(start.getUTCMonth()+1)+'月账期';
      const description=document.createElement('div');description.className='history-info';
      description.textContent='数据截至'+r.asOf+' · '+(k===selectedId()?'当前查看':'历史');
      const number=document.createElement('div');number.className='history-total';number.textContent=fmt(r.total);
      div.append(title,description);row.append(div,number);$('historyList').appendChild(row);
    }
  }
  function render({syncInput=true}={}){
    const s=selectedCycle(),e=shifted(s,1),cycleId=key(s),days=daysBetween(s,e);
    const elapsed=Math.max(0,Math.min(days,daysBetween(s,today)+1));
    const budget=budgetOf(cycleId),rate=budget/days;
    const record=recordOf(cycleId);
    const planned=round(rate*elapsed);
    const actual=record?record.total:null;
    const difference=actual===null?null:round(planned-actual);
    const remaining=actual===null?null:round(budget-actual);
    const futureDays=Math.max(0,days-elapsed);
    const asOfKnown=record?.asOf;
    const isStale=record && asOfKnown < key(addDays(s,Math.max(0,elapsed-1)));
    $('periodLabel').textContent=cnDate(s)+'—'+shortDate(addDays(e,-1));
    $('dayBadge').textContent=(elapsed===0?'尚未开始':'第'+elapsed+'/'+days+'天');
    $('totalBudget').textContent=fmt(budget,0);
    $('expectedSpent').textContent=fmt(planned);
    $('remaining').textContent=remaining===null?'—':trimCurrency(remaining);
    $('daysRemaining').textContent=futureDays+' 天';
    $('dailyAllowance').textContent=remaining===null?'—':futureDays>0?trimCurrency(round(remaining/futureDays)):'本期已结束';
    $('timePct').textContent=(elapsed/days*100).toFixed(1)+'%';
    $('timeProgress').style.width=(elapsed/days*100)+'%';
    $('spendingPct').textContent=actual===null?'未录入':(actual/budget*100).toFixed(1)+'%';
    $('spendingProgress').style.width=actual===null?'0%':Math.min(100,Math.max(0,actual/budget*100))+'%';
    $('difference').textContent=difference===null?'—':(difference>=0?'+':'−')+fmt(Math.abs(difference));
    $('difference').style.color=difference!==null&&difference<0?'#ffb5ac':'#fff';
    $('differenceDescription').textContent=difference===null?'本期暂未记录消费':(difference>=0?'比理论预算少花':'比理论预算多花')+fmt(Math.abs(difference))+(isStale?' · 数据待更新':'');
    $('lastUpdated').textContent=record?'已记录至'+record.asOf+(isStale?'（非今日）':''):'本账期尚无记录';
    $('coverageNotice').textContent=isStale?`当前消费仅记录至${record.asOf}，${record.asOf}至${key(addDays(s,Math.max(0,elapsed-1)))}之间未录入的消费不等于零，当前结余仅供参考。`:"提醒：消费记录不会自动同步微信或支付宝；信用卡刷卡应计入消费，后续还款不再重复计算。";
    if(syncInput){$('totalInput').value=actual===null?'':String(actual);dirty=false;}
    $('budgetInput').value=String(budget);
    $('incomeInput').value=Object.prototype.hasOwnProperty.call(data.income,cycleId)?String(data.income[cycleId]):'';
    $('prev').disabled=s<date(2026,9,15)||key(s)==='2026-10-15';
    $('next').disabled=s>=currentCycle();
    renderHistory();
    renderAssets({syncInput});
  }
  async function saveExpense(event){
    event.preventDefault();
    const raw=$('totalInput').value.trim(),amount=Number(raw);
    if(!raw || !isAmount(amount)){showMessage('请输入有效的累计消费金额');return;}
    const s=selectedCycle(),e=shifted(s,1),id=key(s);
    const asOf=(key(today)>=key(e))?key(addDays(e,-1)):(key(today)<id?id:key(today));
    data.records[id]={total:round(amount),asOf,source:'手动更新'};
    $('saveBtn').disabled=true;
    const ok=await persist();$('saveBtn').disabled=false;
    render();
    showMessage(ok?'已保存至本机 ✓':'仅本次会话有效，请及时导出备份');
  }
  async function saveBudget(){
    const raw=$('budgetInput').value.trim(),amount=Number(raw);
    if(raw&&(!Number.isFinite(amount)||amount<=0||amount>99999999)){showMessage('预算金额无效');return;}
    if(!raw)delete data.budgets[selectedId()];else data.budgets[selectedId()]=round(amount);const ok=await persist();render();showMessage(ok?'本期预算已保存 ✓':'未能持久保存，请导出备份');
  }
  async function saveIncome(){
    const raw=$('incomeInput').value.trim(),amount=Number(raw);
    if(raw && !isAmount(amount)){showMessage('收入金额无效');return;}
    if(!raw)delete data.income[selectedId()];else data.income[selectedId()]=round(amount);
    const ok=await persist();render({syncInput:false});showMessage(ok?'本期收入已保存 ✓':'未能持久保存，请导出备份');
  }
  function exportBackup(){
    const text=JSON.stringify({...data,exportedAt:new Date().toISOString(),format:'cn-budget-cycle-pwa-v1'},null,2);
    const file=new File([text],`消费与资产备份-${key(today)}.json`,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[file]})&&navigator.share){
      navigator.share({files:[file],title:'消费与资产备份'}).catch(e=>{if(e.name!=='AbortError')downloadBackup(file)});
    }else downloadBackup(file);
    showMessage('备份文件已生成 ✓');
  }
  function downloadBackup(file){
    const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function importBackup(evt){
    const file=evt.target.files?.[0];if(!file)return;
    try{
      if(file.size>2e6)throw Error('备份文件超过 2 MB，不符合本应用格式');
      const content=JSON.parse(await file.text());
      if(content.format!=='cn-budget-cycle-pwa-v1')throw Error('无效的备份文件：非本应用生成');
      const incoming=clean(content);
      if(!confirm('恢复备份将覆盖当前设备上的所有已保存数据，确定继续吗？'))return;
      data=incoming;const ok=await persist();offset=0;render();showMessage(ok?'备份已恢复 ✓':'恢复后无法持久保存，请检查设备存储空间或权限');
    }catch(e){showMessage('恢复失败：'+e.message)}finally{evt.target.value=''}
  }
  function refreshDateOnForeground(){
    const next=getChinaDate();if(key(next)!==key(today)){today=next;offset=0;render();showMessage('已切换至新日期')}
  }
  function isSignedAmount(n){return Number.isFinite(n)&&Math.abs(n)<=99999999;}
  function isSnapshotDate(day){if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const d=new Date(day+'T00:00:00Z');return Number.isFinite(d.getTime())&&key(d)===day;}
  function assetTotals(r){const accounts=round(r.bank+r.okx+r.futu);return {accounts,debt:r.debt,net:round(accounts-r.debt)};}
  function assetEntries(){return Object.entries(data.assetRecords||{}).filter(([day])=>day<=key(today)).sort(([a],[b])=>b.localeCompare(a));}
  function setView(assets){$('spendingPanel').hidden=assets;$('assetsPanel').hidden=!assets;$('spendingTab').classList.toggle('active',!assets);$('assetsTab').classList.toggle('active',assets);$('spendingTab').setAttribute('aria-pressed',String(!assets));$('assetsTab').setAttribute('aria-pressed',String(assets));$('coverageNotice').hidden=assets;}
  function fillAssetDate(){const entries=assetEntries(),day=$('assetDate').value;const r=data.assetRecords[day]||entries.find(([d])=>d<=day)?.[1];if(r){$('bankAsset').value=r.bank;$('okxAsset').value=r.okx;$('futuAsset').value=r.futu;$('debtAsset').value=r.debt;}else{for(const field of ['bankAsset','okxAsset','futuAsset'])$(field).value='';$('debtAsset').value='0';}$('assetMessage').textContent=data.assetRecords[day]?'该日期已有快照，保存将更新当天数据':r?'已带入上次余额，请按所选日期的实际金额更新':'';}
  function renderAssets({syncInput=true}={}){
    const entries=assetEntries(),latest=entries[0],previous=entries[1];
    const totals=latest?assetTotals(latest[1]):null;
    $('netAssets').textContent=totals?trimCurrency(totals.net):'—';$('netAssets').classList.toggle('asset-negative',!!totals&&totals.net<0);
    $('grossAssets').textContent=totals?trimCurrency(totals.accounts):'—';$('totalLiabilities').textContent=totals?fmt(totals.debt):'—';
    $('assetAsOf').textContent=latest?'最新快照：'+latest[0]+(latest[0]!==key(today)?' · 非今日余额':' · 今日余额'):'先记录一次账户余额';
    const change=previous?round(totals.net-assetTotals(previous[1]).net):null;
    $('assetChange').textContent=change===null?'—':(change>=0?'+':'−')+fmt(Math.abs(change));$('assetChange').classList.toggle('asset-negative',change!==null&&change<0);
    const comparison=previous?'对比'+previous[0]+'，含投资涨跌（净资产变化受市场波动影响，不等于纯储蓄）。':'至少记录两个不同日期的快照，才能对比净资产变化。';
    $('assetChange').title=comparison;$('assetComparison').textContent=comparison;
    if(syncInput){$('assetDate').value=key(today);fillAssetDate();}$('assetDate').max=key(today);
    const id=selectedId(),income=Object.prototype.hasOwnProperty.call(data.income,id)?data.income[id]:null,expense=recordOf(id);
    const saving=income!==null&&expense?round(income-expense.total):null;
    $('cashSavings').textContent=saving===null?'—':trimCurrency(saving);$('cashSavings').classList.toggle('asset-negative',saving!==null&&saving<0);
    $('savingsCaption').textContent=saving===null?'先录入本期收入与累计消费，即可计算结余。':fmt(income)+'收入 −'+fmt(expense.total)+'已录入消费（消费截至'+expense.asOf+'）';
    $('assetHistoryCount').textContent='共'+entries.length+'次';$('assetHistory').replaceChildren();
    if(!entries.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='暂无资产快照';$('assetHistory').appendChild(empty);}
    for(const [day,r] of entries.slice(0,12)){const row=document.createElement('div');row.className='history-item';const left=document.createElement('div');const title=document.createElement('div');title.className='history-name';title.textContent=day;const sub=document.createElement('div');sub.className='history-info';sub.textContent='银行'+fmt(r.bank,0)+' · 欧意'+trimCurrency(r.okx)+' · 富途'+trimCurrency(r.futu);const amount=document.createElement('div');amount.className='history-total';amount.textContent=trimCurrency(assetTotals(r).net);left.append(title,sub);row.append(left,amount);$('assetHistory').appendChild(row);}
  }
  async function saveAssets(event){event.preventDefault();const fields=['bankAsset','okxAsset','futuAsset','debtAsset'];const raw=fields.map(id=>$(id).value.trim());const [bank,okx,futu,debt]=raw.map(Number);const day=$('assetDate').value;
    if(raw.some(v=>v==='')||!isAmount(bank)||!isSignedAmount(okx)||!isSignedAmount(futu)||!isAmount(debt)){$('assetMessage').textContent='请填写四项人民币余额，没有的账户请填 0';return;}
    if(!isSnapshotDate(day)||day>key(today)){$('assetMessage').textContent='请选择今天或之前的有效日期';return;}
    data.assetRecords[day]={bank:round(bank),okx:round(okx),futu:round(futu),debt:round(debt)};$('assetSave').disabled=true;const ok=await persist();$('assetSave').disabled=false;renderAssets({syncInput:false});$('assetMessage').textContent=ok?'已保存'+day+'的资产快照 ✓':'仅本次会话有效，请及时导出备份';
  }
  async function start(){
    await initializeStorage();
    render();
    $('totalForm').addEventListener('submit',saveExpense);
    $('assetForm').addEventListener('submit',saveAssets);
    $('assetDate').addEventListener('change',fillAssetDate);
    $('spendingTab').addEventListener('click',()=>setView(false));
    $('assetsTab').addEventListener('click',()=>setView(true));
    $('prev').addEventListener('click',()=>{offset-=1;showMessage('');render()});
    $('next').addEventListener('click',()=>{offset+=1;showMessage('');render()});
    $('totalInput').addEventListener('input',()=>{dirty=true;showMessage('修改后请点击保存')});
    $('budgetSave').addEventListener('click',saveBudget);
    $('incomeSave').addEventListener('click',saveIncome);
    $('exportBtn').addEventListener('click',exportBackup);
    $('importFile').addEventListener('change',importBackup);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDateOnForeground()});
    window.addEventListener('pageshow',refreshDateOnForeground);
    if('serviceWorker' in navigator && location.protocol==='https:'){
      const hadController=!!navigator.serviceWorker.controller;
      let formEdited=false,reloaded=false;
      document.addEventListener('input',()=>{formEdited=true;},{once:true});
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        if(!hadController||reloaded)return;
        if(formEdited){showMessage('新版文案已就绪，保存后重新打开即可更新');return;}
        reloaded=true;location.reload();
      });
      navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
        reg.update().catch(()=>{});
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)reg.update().catch(()=>{});});
      }).catch(()=>{});
    }
  }
  start().catch(e=>{showMessage('初始化异常：'+e.message);render()});
})();



