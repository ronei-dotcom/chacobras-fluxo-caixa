import {INPUT_META,CALC_LABELS} from './meta.js';
import {YEARS,BANKS,GROWTH,OWNER_EMAIL,clone,blankState,canonical,calculate,reconcile,projectSeries,BANK_REPORT,TOTAL_ROWS,DETAIL_INCOME,DETAIL_COST,validate} from './model.js';
import {connect} from './cloud.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=2)=>{const n=Math.abs(v)<0.5*10**-d?0:v;return new Intl.NumberFormat('es-PY',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);};
const money=v=>`USD ${fmt(v,0)}`;
const pretty=(v,unit)=>unit==='%'?`${fmt(v*100,2)}%`:fmt(v,unit==='días'?0:unit==='kg/cab/día'?3:2);
const editable=()=>mode==='local'||role==='owner'||role==='editor';
let state=null,calc=null,dirty=false,mode='none',cloud=null,user=null,role=null,baseRevision=0,remote=null,saving=false,tabName='flow',unsubscribe=null,authObserved=false,noticeTimer;
let authEpoch=0;
function toast(message,error=false){$('status').textContent=message;$('status').className=`status visible${error?' error':''}`;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('status').className='status',error?14000:7000);}
function explain(err){
 if(err.message==='CONFLICT')return 'Outra pessoa salvou uma versão mais recente. Baixe seu backup e carregue a versão compartilhada antes de salvar.';
 const code=err.code||'';
 if(code.includes('unauthorized-domain'))return 'Autorize ronei-dotcom.github.io em Firebase → Authentication → Configurações → Domínios autorizados.';
 if(code.includes('popup-blocked'))return 'O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente novamente.';
 if(code.includes('popup-closed')||code.includes('cancelled-popup'))return 'Entrada no Google cancelada.';
 if(code.includes('permission-denied'))return 'Acesso negado pelo Firebase. Confira a conta Google e publique as regras fornecidas no pacote. O aplicativo não alterou as regras automaticamente.';
 if(code.includes('unavailable')||code.includes('network'))return 'Não foi possível conectar ao Firebase. Confira a conexão. Suas alterações continuam nesta página; baixe um backup antes de fechar.';
 return err.message||'Não foi possível concluir a operação.';
}
function markDirty(){dirty=true;updateStatus();renderFlow();}
function updateStatus(){
 $('connection').textContent=mode==='local'?'Arquivo local':user?.email||'Acesso restrito';
 $('logout').hidden=mode!=='cloud'||!user;
 $('local-warning').hidden=mode!=='local';
 $('save').textContent=mode==='local'?'Baixar alterações':saving?'Salvando…':'Salvar no Firebase';
 $('save').disabled=!editable()||saving||!state||mode==='cloud'&&remote?.revision>baseRevision;
 $('import').disabled=!editable()||saving;
 $('conflict').hidden=!(mode==='cloud'&&dirty&&remote?.revision>baseRevision&&!saving);
 $('access-tab').hidden=role!=='owner'||mode!=='cloud';
 const time=remote?.updatedAt?.toDate?.();
 $('save-status').textContent=mode==='local'?(dirty?'Alterações locais ainda não exportadas.':'Cenário local — sem sincronização.'):
   `${role==='viewer'?'Somente consulta · ':''}Versão ${baseRevision}${time?` · ${time.toLocaleString('pt-BR')} · ${remote.updatedBy}`:''}${dirty?' · Alterações não salvas':''}${remote?.cached?' · Aguardando confirmação do servidor':''}`;
}
function showWorkspace(){
 $('welcome').hidden=true;$('workspace').hidden=false;
 updateStatus();renderFlow();renderInputs();renderDebts();renderChecks();renderDetail();
}
function setState(s,{changed=false}={}){state=canonical(s);calc=calculate(state);dirty=changed;showWorkspace();}
function resetUI(){state=null;calc=null;dirty=false;baseRevision=0;remote=null;role=null;$('workspace').hidden=true;$('welcome').hidden=false;updateStatus();}
function table(rows,indices=YEARS.map((_,i)=>i),printing=false){
 const showZeros=!printing&&$('zeros').checked;
 return `<table><thead><tr><th>Concepto / USD</th>${indices.map(i=>`<th>${YEARS[i]}</th>`).join('')}</tr></thead><tbody>${rows.filter(r=>r.total||showZeros||r.values.some(v=>Math.abs(v)>.000001)).map(r=>`<tr class="${r.major?'major':r.total?'total':''}"><td>${esc(r.label)}${r.unit&&r.unit!=='USD'?` <small>(${esc(r.unit)})</small>`:''}</td>${indices.map(i=>`<td class="${r.values[i]<-.005?'negative':''}">${r.unit?pretty(r.values[i],r.unit):fmt(r.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function flowRows(){return BANK_REPORT.map(r=>({label:CALC_LABELS[r],values:calc[r],unit:'USD',total:TOTAL_ROWS.includes(r),major:[6,74,75].includes(r)}));}
function detailRows(spec){return spec.map(([label,unit,source,total])=>({label,unit,total,values:YEARS.map((_,i)=>typeof source==='function'?source(state,calc,i):calc[source][i])}));}
function renderDetail(){
 if(!state)return;
 try{calc=calculate(state);$('detail-tables').innerHTML=[['Memoria de cálculo · ingresos',DETAIL_INCOME],['Memoria de cálculo · costos',DETAIL_COST]].map(([title,spec])=>`<section class="input-section"><h3>${title}</h3><div class="table-wrap">${table(detailRows(spec))}</div></section>`).join('');}
 catch{$('detail-tables').innerHTML='<p class="warning">Revise os campos inválidos em Premissas ou Dívidas para exibir o detalhamento.</p>';}
}
function renderFlow(){
 if(!state)return;
 try{calc=calculate(state);}catch(err){$('metrics').innerHTML='<p class="warning">Revise os campos inválidos em Premissas ou Dívidas para recalcular o fluxo.</p>';$('flow-table').innerHTML='';return;}
 const first=0,last=9,min=Math.min(...calc[75]),mi=calc[75].indexOf(min);
 $('metrics').innerHTML=[['Receita projetada · 2026',money(calc[7][first]),'Gado + nutrição + arrendamentos'],['Fluxo operacional · 2026',money(calc[6][first]),'Receitas menos despesas operacionais'],[`Menor saldo · ${YEARS[mi]}`,money(min),'Saldo acumulado ao fim do ano'],['Saldo acumulado · 2035',money(calc[75][last]),'Inclui financiamentos e investimentos']].map(([a,b,c])=>`<article class="metric"><span>${a}</span><strong>${b}</strong><small>${c}</small></article>`).join('');
 $('flow-table').innerHTML=table(flowRows());
}
const GROUPS=[['Produção e receitas',[8,9,10,11,12,13]],['Compra e desenvolvimento do rebanho',[14,15,16,17,18,19,20,21]],['Manutenção e caixa',[22,23]],['Financiamentos e investimentos',[25,27,28,29,30,31,32]],['Parâmetros gerais',[40,41,42,43,44]],['Patrimônio — uso interno, fora do relatório bancário',[36,46,47,48]]];
function inputHTML(r,i){const m=INPUT_META[r],pct=m.unit==='%',val=state.inputs[r][i],shown=typeof val==='number'&&Number.isFinite(val)?(pct?Number((val*100).toPrecision(12)):Number(val.toPrecision(12))):'';return `<input aria-label="${esc(m.label)} ${YEARS[i]}" type="number" min="0" ${pct?'max="100"':''} step="any" value="${shown}" data-row="${r}" data-year="${i}" ${editable()?'':'disabled'}>`;}
function renderInputs(){
 if(!state)return;
 $('input-groups').innerHTML=`<label class="field inline">Empresa<input id="company-name" maxlength="100" value="${esc(state.company)}" ${editable()?'':'disabled'}></label><section class="input-section"><h3>Taxas de projeção</h3><p class="muted">Alterar a taxa não sobrescreve os valores anuais. Clique em Projetar série para recalcular de 2027 a 2035 a partir de 2026. Sobrepreço soma pontos percentuais; as demais taxas multiplicam o valor anterior.</p><div class="rate-panel">${GROWTH.map(r=>`<label class="field">${esc(INPUT_META[r].label)} · ${r===14?'p.p./ano':'%/ano'}<div class="rate-actions"><input type="number" step="any" min="-99" max="1000" value="${typeof state.rates[r]==='number'?Number((state.rates[r]*100).toPrecision(12)):''}" data-rate="${r}" aria-label="Taxa ${esc(INPUT_META[r].label)}" ${editable()?'':'disabled'}><button type="button" class="outline" data-project="${r}" ${editable()?'':'disabled'}>Projetar série</button></div></label>`).join('')}</div></section>`+
 GROUPS.map(([title,rows])=>`<section class="input-section"><h3>${esc(title)}</h3><div class="table-wrap"><table class="inputs-table"><thead><tr><th>Premissa</th>${YEARS.map(y=>`<th>${y}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(INPUT_META[r].label)}<small>${esc(INPUT_META[r].unit)}${INPUT_META[r].scope==='single'?' · valor único':''}</small></td>${YEARS.map((_,i)=>`<td>${INPUT_META[r].scope==='single'&&i>0?'—':inputHTML(r,i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('');
}
function renderDebts(){
 if(!state)return;$('debt-status').value=state.debtStatus;$('debt-status').disabled=!editable();$('add-debt').disabled=!editable();
 const disabled=editable()?'':'disabled';
 $('debt-table').innerHTML=`<table class="debt-table"><thead><tr><th>Banco</th><th>Contrato</th><th>Vencimento</th><th>Principal · USD</th><th>Juros · USD</th><th>Observação</th><th></th></tr></thead><tbody>${state.debts.map((d,i)=>`<tr data-debt="${i}"><td><select data-key="bank" aria-label="Banco parcela ${i+1}" ${disabled}>${BANKS.map(b=>`<option ${d.bank===b?'selected':''}>${b}</option>`).join('')}</select></td><td><input data-key="contract" aria-label="Contrato parcela ${i+1}" value="${esc(d.contract)}" maxlength="100" ${disabled}></td><td><input data-key="due" aria-label="Vencimento parcela ${i+1}" type="date" min="2026-01-01" value="${d.due}" ${disabled}></td><td><input data-key="principal" aria-label="Principal parcela ${i+1}" type="number" step="any" min="0" value="${d.principal}" ${disabled}></td><td><input data-key="interest" aria-label="Juros parcela ${i+1}" type="number" step="any" min="0" value="${d.interest}" ${disabled}></td><td><input data-key="note" aria-label="Observação parcela ${i+1}" value="${esc(d.note)}" maxlength="500" ${disabled}></td><td><button data-remove="${i}" ${disabled}>Excluir</button></td></tr>`).join('')||'<tr><td colspan="7">Nenhuma parcela cadastrada.</td></tr>'}</tbody></table>`;
 renderDebtSummary();
}
function renderDebtSummary(){const debts=state.debts;$('debt-summary').textContent=`${debts.length} parcelas · Principal: ${money(debts.reduce((a,d)=>a+(Number(d.principal)||0),0))} · Juros: ${money(debts.reduce((a,d)=>a+(Number(d.interest)||0),0))}. Parcelas após 2035 ficam no cadastro e não entram no fluxo de 2026–2035.`;}
function renderChecks(){
 if(!state)return;
 const errors=validate(state),warning=[];
 if(state.debtStatus==='PENDIENTE')warning.push('O cronograma foi marcado como pendente: o relatório sai como preliminar.');
 if(state.debts.some(d=>d.principal>0&&d.interest===0))warning.push('Há parcelas com principal informado e juros zerados. Confirme se a ausência de juros está correta.');
 if(state.debts.some(d=>d.due>'2035-12-31'))warning.push('Há parcelas após 2035. Elas permanecem cadastradas, mas ficam fora dos dez anos do fluxo.');
 const issue=(title,text,warn=false)=>`<article class="check-result${warn?' warn':''}"><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`;
 let html=errors.map(e=>issue('Campo a revisar',e,true)).join('');
 if(!errors.length){calc=calculate(state);const checks=reconcile(state,calc),ok=checks.every(row=>Object.entries(row).filter(([k])=>k!=='year').every(([,v])=>Math.abs(v)<=.01));
 html+=issue(ok?'Conciliações sem diferenças materiais':'Revise as conciliações','Receitas, fluxo anual, saldo acumulado e movimentação do rebanho nos dez anos.',!ok);
 html+=`<div class="table-wrap"><table><thead><tr><th>Ano</th><th>Receitas</th><th>Fluxo anual</th><th>Caixa</th><th>Rebanho</th></tr></thead><tbody>${checks.map(r=>`<tr><td>${r.year}</td>${['income','flow','cash','herd'].map(k=>`<td>${fmt(Math.abs(r[k])<.005?0:r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 if(calc[21].some(v=>v<0))warning.push('O estoque final do rebanho ficou negativo em pelo menos um ano.');
 if(calc[75].some(v=>v<0))warning.push('Há saldo acumulado negativo em pelo menos um ano: avalie a necessidade de financiamento.');
 }
 $('checks').innerHTML=html+warning.map(w=>issue('Atenção',w,true)).join('')+issue('Escopo da conferência','O sistema verifica consistência e reconciliação. A confirmação das quantidades, preços e compromissos cabe à empresa.');
}
async function changeTab(name){tabName=name;document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${name}`);document.querySelectorAll('#tabs button').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));if(name==='detail')renderDetail();if(name==='checks')renderChecks();if(name==='history')await renderHistory();if(name==='access')await renderMembers();}
async function renderHistory(){
 if(mode==='local'){$('history-content').innerHTML='<p class="note">O histórico é registrado nos salvamentos no Firebase. Para o modo local, guarde backups JSON com data.</p>';return;}
 try{const rows=await cloud.history();$('history-content').innerHTML=rows.length?rows.map((r,i)=>`<article class="history-item"><div><strong>Versão ${r.revision}</strong><p class="muted">${esc(r.updatedBy)} · ${esc(r.updatedAt?.toDate?.().toLocaleString('pt-BR')||'Data em confirmação')}</p></div><div class="actions"><button class="outline" data-history-download="${i}">Baixar JSON</button>${editable()?`<button class="outline" data-restore="${i}">Carregar para revisão</button>`:''}</div></article>`).join(''):'<p class="muted">Ainda não há versões salvas.</p>';
 $('history-content').onclick=ev=>{const b=ev.target.closest('button');if(!b)return;try{if(b.dataset.historyDownload!==undefined)download(JSON.parse(rows[b.dataset.historyDownload].payload),`Chacobras_v${rows[b.dataset.historyDownload].revision}.json`);if(b.dataset.restore!==undefined&&editable()){if(!confirm('Carregar esta versão para revisão? As edições atuais serão substituídas nesta página. O Firebase só será alterado quando você salvar.'))return;setState(JSON.parse(rows[b.dataset.restore].payload),{changed:true});toast('Versão carregada para revisão. Salve para criar uma nova versão compartilhada.');}}catch(e){toast(explain(e),true);}};
 }catch(e){toast(explain(e),true);}
}
async function renderMembers(){
 if(role!=='owner'||mode!=='cloud')return;
 try{const list=await cloud.members();$('member-list').innerHTML=`<article class="member-item"><div><strong>${OWNER_EMAIL}</strong><p class="muted">Administrador</p></div></article>`+list.map(m=>`<article class="member-item"><div><strong>${esc(m.email)}</strong><p class="muted">${m.role==='editor'?'Editar e consultar':m.role==='viewer'?'Somente consulta':'Acesso desativado'}</p></div>${m.role!=='disabled'?`<button class="outline" data-revoke="${esc(m.email)}">Desativar acesso</button>`:''}</article>`).join('');}catch(e){toast(explain(e),true);}
}
function download(s,name){const clean=canonical(s);const blob=new Blob([JSON.stringify(clean,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function backup(){download(state,`Chacobras_Fluxo_${new Date().toISOString().slice(0,10)}.json`);if(mode==='local'){dirty=false;updateStatus();toast('Backup gerado. Confira o arquivo na pasta Downloads antes de fechar.');}}
async function startCloud(){
 $('login').disabled=true;
 try{
  if(mode==='local'&&dirty&&!confirm('Há edições locais. Baixe um backup antes de entrar no compartilhado. Continuar sem o backup?'))return;
  cloud=await connect();
  if(!authObserved){authObserved=true;cloud.observeAuth(async u=>{
   const epoch=++authEpoch;
   if(!u){if(mode==='cloud'){unsubscribe?.();unsubscribe=null;user=null;resetUI();}return;}
   try{
    const newRole=await cloud.role(u);if(epoch!==authEpoch)return;
    if(!['owner','editor','viewer'].includes(newRole)){toast('Esta conta ainda não tem acesso. Peça ao administrador para liberar seu e-mail.',true);return;}
    unsubscribe?.();user=u;role=newRole;mode='cloud';dirty=false;baseRevision=0;remote=null;
    unsubscribe=cloud.observe(doc=>{
     remote=doc;
     if(!doc){if(!state||mode==='cloud'&&!dirty){state=blankState();calc=calculate(state);showWorkspace();toast('Ainda não há dados compartilhados. O administrador deve importar o JSON inicial e salvar.');}return;}
     if(!dirty&&!saving){baseRevision=doc.revision;setState(JSON.parse(doc.payload));}
     updateStatus();
    },e=>{unsubscribe?.();unsubscribe=null;user=u;resetUI();mode='cloud';toast(explain(e),true);});
   }catch(e){if(epoch===authEpoch)toast(explain(e),true);}
  });}
  await cloud.login();
 }catch(e){toast(explain(e),true);}finally{$('login').disabled=false;}
}
function startLocal(s=blankState(),changed=false){unsubscribe?.();unsubscribe=null;mode='local';role=null;user=null;baseRevision=0;remote=null;setState(s,{changed});changeTab('flow');}
async function save(){
 if(!state||!editable()||saving)return;
 if(mode==='local'){try{backup();}catch(e){toast(explain(e),true);}return;}
 saving=true;updateStatus();
 try{const saved=canonical(state);const revision=await cloud.save(saved,baseRevision,user);baseRevision=revision;dirty=false;toast(`Versão ${revision} salva no Firebase.`);}
 catch(e){toast(explain(e),true);}finally{saving=false;updateStatus();}
}
function printReport(detail){
 try{state=canonical(state);calc=calculate(state);}catch(e){toast(explain(e),true);return;}
 const sets=[['Flujo de caja proyectado',flowRows()]];
 if(detail)for(const [title,spec] of [['Memoria de cálculo · ingresos',DETAIL_INCOME],['Memoria de cálculo · costos',DETAIL_COST]])sets.push([title,detailRows(spec)]);
 const pages=[];for(const [title,rows]of sets)for(const offset of [0,5])pages.push({title,rows,indices:[0,1,2,3,4].map(i=>i+offset)});
 const stamp=new Date().toLocaleDateString('es-PY'),prelim=state.debtStatus==='PENDIENTE'?' · PRELIMINAR — CRONOGRAMA PENDIENTE':'';
 $('print-root').innerHTML=pages.map((p,i)=>`<section class="print-page"><header class="print-head"><div><h1>${esc(state.company)}</h1><h2>${esc(p.title)} · ${YEARS[p.indices[0]]}–${YEARS[p.indices[4]]}</h2></div><span>USD · ${stamp}${prelim}<br>${mode==='local'?'Archivo local':`Versión ${baseRevision}`}${dirty?' · Borrador — cambios sin guardar':''}</span></header>${table(p.rows,p.indices,true)}<p class="print-note">Proyección elaborada sobre las premisas informadas por la empresa. Cantidades sin redondeo de cabezas en el cálculo. La compra de estancia se incluye como egreso de inversión; no se suma a las deudas bancarias.</p><footer class="print-footer"><span>CHACOBRAS · Flujo de caja y memoria de cálculo</span><span>${i+1} / ${pages.length}</span></footer></section>`).join('');
 window.print();
}

$('login').onclick=startCloud;
$('logout').onclick=async()=>{if(dirty&&!confirm('Há alterações não salvas. Sair sem salvar?'))return;try{await cloud.logout();unsubscribe?.();mode='none';user=null;resetUI();}catch(e){toast(explain(e),true);}};
$('local').onclick=()=>{$('file-input').dataset.local='true';$('file-input').click();};
$('new-local').onclick=()=>{startLocal();toast('Cenário vazio criado. Importe o JSON inicial para trabalhar com os números do Excel.');};
$('import').onclick=()=>{if(!editable())return;$('file-input').dataset.local='false';$('file-input').click();};
$('file-input').onchange=async ev=>{const file=ev.target.files[0];if(!file)return;try{if(file.size>300000)throw new Error('O JSON ultrapassa 300 KB. Selecione o backup do fluxo, sem anexos.');const s=canonical(JSON.parse(await file.text()));if(dirty&&!confirm('Substituir as edições atuais pelos dados deste arquivo? O Firebase só muda quando você salvar.'))return;if(ev.target.dataset.local==='true'||mode==='none')startLocal(s,true);else setState(s,{changed:true});toast('Dados importados. Confira Premissas e Dívidas antes de salvar.');}catch(e){toast(explain(e),true);}finally{ev.target.value='';}};
$('save').onclick=save;$('export').onclick=()=>{try{backup();}catch(e){toast(explain(e),true);}};
$('zeros').onchange=renderFlow;
$('print-bank').onclick=()=>printReport(false);$('print-detail').onclick=()=>printReport(true);
$('tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(b)changeTab(b.dataset.tab);};
$('input-groups').oninput=e=>{if(!editable())return;const t=e.target;
 if(t.id==='company-name'){state.company=t.value;markDirty();return;}
 if(t.dataset.row){const pct=INPUT_META[t.dataset.row].unit==='%';state.inputs[t.dataset.row][Number(t.dataset.year)]=t.value===''?null:Number(t.value)/(pct?100:1);markDirty();}
 if(t.dataset.rate){state.rates[t.dataset.rate]=t.value===''?null:Number(t.value)/100;markDirty();}
};
$('input-groups').onclick=e=>{if(!editable())return;const b=e.target.closest('[data-project]');if(!b)return;const r=Number(b.dataset.project);if(!confirm(`Substituir os valores de 2027–2035 de “${INPUT_META[r].label}” pela projeção a partir de 2026?`))return;try{const copy=clone(state);projectSeries(copy,r);canonical(copy);state=copy;markDirty();renderInputs();toast('Série anual recalculada. Confira os valores antes de salvar.');}catch(e){toast(explain(e),true);}};
$('debt-status').onchange=e=>{if(editable()){state.debtStatus=e.target.value;markDirty();}};
$('add-debt').onclick=()=>{if(!editable())return;if(state.debts.length>=500){toast('Limite de 500 parcelas atingido.',true);return;}state.debts.push({bank:'NUEVOS',contract:'',due:'2026-12-31',principal:0,interest:0,note:''});markDirty();renderDebts();};
$('debt-table').oninput=e=>{if(!editable()||!e.target.dataset.key)return;const t=e.target,i=Number(t.closest('[data-debt]').dataset.debt),k=t.dataset.key;state.debts[i][k]=['principal','interest'].includes(k)?t.value===''?null:Number(t.value):t.value;markDirty();renderDebtSummary();};
$('debt-table').onchange=e=>{if(e.target.tagName==='SELECT')$('debt-table').oninput(e);};
$('debt-table').onclick=e=>{if(!editable())return;const b=e.target.closest('[data-remove]');if(b&&confirm('Excluir esta parcela do cenário atual? A exclusão será gravada no próximo salvamento; versões anteriores permanecem no histórico.')){state.debts.splice(Number(b.dataset.remove),1);markDirty();renderDebts();}};
$('reload-remote').onclick=()=>{if(remote&&confirm('Carregar a versão compartilhada e substituir as edições desta página? Baixe seu backup antes de continuar.')){baseRevision=remote.revision;setState(JSON.parse(remote.payload));toast('Versão compartilhada carregada.');}};
$('refresh-history').onclick=renderHistory;
$('access-form').onsubmit=async e=>{e.preventDefault();if(role!=='owner')return;const email=$('member-email').value.trim().toLowerCase(),r=$('member-role').value;try{if(email===OWNER_EMAIL)throw new Error('O administrador já tem acesso.');await cloud.setMember(email,r);toast('Permissão salva. A pessoa deve entrar com esta conta Google.');$('member-email').value='';await renderMembers();}catch(err){toast(explain(err),true);}};
$('member-list').onclick=async e=>{const b=e.target.closest('[data-revoke]');if(!b||role!=='owner'||!confirm(`Desativar o acesso de ${b.dataset.revoke}?`))return;try{await cloud.revoke(b.dataset.revoke);await renderMembers();toast('Acesso desativado.');}catch(err){toast(explain(err),true);}};
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('offline',()=>{if(mode==='cloud')toast('Sem conexão. Salvar no Firebase exige internet; baixe um backup para guardar as edições.',true);});
