import { INPUT_META } from './meta.js';

export const YEARS = Array.from({length:10},(_,i)=>2026+i);
export const BANKS = ['ITAU','SUDAMERIS','CONTINENTAL','ATLAS','FPJ','GNB','BANCOP','BNF','NUEVOS'];
export const GROWTH = [8,9,11,12,14,16,19,22];
export const OWNER_EMAIL = 'roneizoo@gmail.com';
const clone = v => JSON.parse(JSON.stringify(v));
export { clone };

export function validate(raw) {
  const errors=[];
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return ['Arquivo inválido.'];
  if(raw.schemaVersion!==1 || raw.startYear!==2026 || raw.currency!=='USD') errors.push('Formato incompatível: esperado Chacobras 2026–2035 em USD, versão 1.');
  if(typeof raw.company!=='string' || !raw.company.trim() || raw.company.length>100) errors.push('Informe o nome da empresa (até 100 caracteres).');
  if(!['COMPLETA','PENDIENTE'].includes(raw.debtStatus)) errors.push('Informe a situação do cronograma de dívidas.');
  for(const [r,m] of Object.entries(INPUT_META)) {
    const v=raw.inputs?.[r];
    if(!Array.isArray(v) || v.length!==10 || v.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1e12)) {errors.push(`Valor inválido em ${m.label}.`);continue;}
    if(m.unit==='%' && v.some(x=>x>1)) errors.push(`${m.label}: use um percentual entre 0 e 100%.`);
  }
  for(const r of GROWTH) {
    const v=raw.rates?.[r];
    if(typeof v!=='number'||!Number.isFinite(v)||v<-.99||v>10) errors.push(`Taxa inválida em ${INPUT_META[r].label}.`);
  }
  const cycle=raw.inputs?.[44]?.[0];
  if(!(cycle>=12 && cycle<=24)) errors.push('O ciclo de compra deve estar entre 12 e 24 meses para a regra deste modelo.');
  if(!Array.isArray(raw.debts)||raw.debts.length>500) errors.push('O cronograma aceita até 500 parcelas.');
  else {
    const seen=new Set();
    raw.debts.forEach((d,i)=>{
      if(!d || typeof d!=='object') {errors.push(`Parcela ${i+1} inválida.`);return;}
      const key=`${d.bank}|${String(d.contract).trim()}|${d.due}`;
      const date=typeof d.due==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d.due) ? new Date(`${d.due}T12:00:00Z`) : null;
      if(!BANKS.includes(d.bank) || !String(d.contract??'').trim() || String(d.contract).length>100 || !date || !Number.isFinite(+date) || date.toISOString().slice(0,10)!==d.due || d.due<'2026-01-01' || ![d.principal,d.interest].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e12) || String(d.note??'').length>500) errors.push(`Revise banco, contrato, vencimento e valores da parcela ${i+1}.`);
      if(seen.has(key)) errors.push(`Parcela ${i+1} duplicada: mesmo banco, contrato e vencimento.`);
      seen.add(key);
    });
  }
  return errors;
}

export function canonical(raw) {
  const errors=validate(raw);
  if(errors.length) throw new Error(errors.slice(0,8).join('\n'));
  return {schemaVersion:1,company:raw.company.trim(),currency:'USD',startYear:2026,debtStatus:raw.debtStatus,
    inputs:Object.fromEntries(Object.keys(INPUT_META).map(r=>[r,raw.inputs[r].slice()])),
    rates:Object.fromEntries(GROWTH.map(r=>[r,raw.rates[r]])),
    debts:raw.debts.map(d=>({bank:d.bank,contract:String(d.contract).trim(),due:d.due,principal:d.principal,interest:d.interest,note:String(d.note??'')}))};
}

export function blankState() {
  const s={schemaVersion:1,company:'Chacobras S.A.',currency:'USD',startYear:2026,debtStatus:'PENDIENTE',inputs:{},rates:{},debts:[]};
  for(const r of Object.keys(INPUT_META)) s.inputs[r]=Array(10).fill(0);
  s.inputs[44][0]=16;
  for(const r of GROWTH) s.rates[r]=0;
  return s;
}

// Reapplies only the future years of one selected series, after an explicit UI action.
export function projectSeries(state,row) {
  if(!GROWTH.includes(Number(row))) throw new Error('Esta premissa não usa projeção por taxa.');
  for(let i=1;i<10;i++) state.inputs[row][i]=Number(row)===14 ? state.inputs[row][i-1]+state.rates[row] : state.inputs[row][i-1]*(1+state.rates[row]);
}

export function calculate(raw) {
  const s=canonical(raw), c=Object.fromEntries(Array.from({length:70},(_,i)=>[i+6,Array(10).fill(0)]));
  const p=(r,i=0)=>s.inputs[r][i];
  const sum=(a,b,i)=>Array.from({length:b-a+1},(_,k)=>c[a+k][i]).reduce((a,b)=>a+b,0);
  for(let i=0;i<10;i++) {
    const a=(r,v)=>c[r][i]=v, v=r=>c[r][i];
    a(10,p(8,i)); a(11,p(9,i)); a(13,p(10,i)); a(14,p(11,i)); a(15,p(12,i));
    a(22,p(14,i)); a(24,p(15,i)); a(25,p(16,i)); a(26,p(17,i)); a(28,p(18,i));
    a(30,p(19,i)); a(31,p(20,i)); a(32,p(21,i));
    a(29,v(28)*v(26)); a(33,v(32)*v(31)); a(12,v(24)+v(29)+v(33));
    a(8,v(10)*v(11)*v(12)*v(13)); a(9,v(11)*v(12)*v(13));
    a(7,v(8)+v(14)+v(15));
    a(23,v(11)*(1+v(22))*p(43)); a(18,v(24)*v(23));
    a(19,i===0?p(13):c[21][i-1]);
    const cycle=p(44)/12, grow=s.rates[8];
    const next=i<9?p(8,i+1):p(8,9)*(1+grow);
    const following=i<8?p(8,i+2):p(8,9)*(1+grow)**(i-7);
    a(20,(2-cycle)*next+(cycle-1)*following);
    a(21,v(19)+v(20)-v(10)); a(27,v(21)); a(17,v(18)*v(20));
    a(34,-v(8)*p(40)); a(35,-v(14)*p(41)); a(36,-v(25)*v(26)*v(21));
    a(37,-v(30)*v(31)*v(10)); a(38,-v(8)*p(42)); a(39,-p(22,i)); a(40,-v(17));
    BANKS.forEach((bank,j)=>{
      const debts=s.debts.filter(d=>d.bank===bank && Number(d.due.slice(0,4))===YEARS[i]);
      a(43+j,-debts.reduce((n,d)=>n+d.interest,0));
      a(54+j,-debts.reduce((n,d)=>n+d.principal,0));
    });
    a(42,sum(43,51,i)); a(16,sum(34,42,i)); a(6,v(7)+v(16));
    a(63,p(25,i)); a(53,sum(54,63,i));
    for(let r=66;r<=71;r++) a(r,-p(r-39,i));
    a(65,sum(66,71,i)); a(73,i===0?p(23):c[75][i-1]); a(74,v(6)+v(53)+v(65)); a(75,v(73)+v(74));
  }
  for(const [r,values] of Object.entries(c)) if(values.some(x=>!Number.isFinite(x))) throw new Error(`Resultado inválido na linha ${r}. Revise as premissas.`);
  return c;
}

export function reconcile(s,c=calculate(s)) {
  return YEARS.map((year,i)=>({year,
    income:c[7][i]-c[8][i]-c[14][i]-c[15][i],
    flow:c[74][i]-c[6][i]-c[53][i]-c[65][i],
    cash:c[75][i]-c[73][i]-c[74][i],
    herd:c[21][i]-c[19][i]-c[20][i]+c[10][i]
  }));
}

export const BANK_REPORT = [7,8,14,15,16,34,35,36,37,38,39,40,42,6,53,54,55,56,57,58,59,60,61,62,63,65,66,67,68,69,70,71,73,74,75];
export const TOTAL_ROWS = [7,16,42,6,53,65,73,74,75];
export const DETAIL_INCOME = [
 ['Animales vendidos','cabezas',10],['Peso de compra','kg/cabeza',24],['Días de recría en pastura','días',26],
 ['Ganancia diaria en pastura','kg/cab/día',28],['Ganancia de peso en pastura','kg/cabeza',29],
 ['Días de terminación intensiva a pasto','días',31],['Ganancia diaria en terminación intensiva','kg/cab/día',32],
 ['Ganancia de peso en terminación intensiva','kg/cabeza',33],['Peso vivo de venta = compra + ganancias','kg/cabeza',12],
 ['Rendimiento de canal','%',13],['Peso de canal = peso vivo × rendimiento','kg/cabeza',(s,c,i)=>c[12][i]*c[13][i]],
 ['Precio de venta de canal','USD/kg',11],['Valor por cabeza vendida','USD/cabeza',9],
 ['INGRESOS POR VENTA DE GANADO','USD',8,true],['Venta de productos de nutrición','USD',14],
 ['Variación anual de ingresos de nutrición','%',s=>s.rates[11]],['Arrendamiento de pasturas','USD',15],
 ['Variación anual de arrendamientos','%',s=>s.rates[12]],['TOTAL INGRESOS','USD',7,true]
];
export const DETAIL_COST = [
 ['Stock inicial de ganado','cabezas',19],['Ganado comprado','cabezas',20],['Ganado vendido','cabezas',10],
 ['Stock final = inicial + compra − venta','cabezas',21,true],['Peso de compra','kg/cabeza',24],
 ['Precio de compra en pie','USD/kg',23],['Valor por cabeza comprada','USD/cabeza',18],
 ['Compra de ganado: cabezas × valor por cabeza','USD',17,true],['Suplementación en pastura','USD/cab/día',25],
 ['Días de pastura','días',26],['Animales usados en cálculo de pastura (stock final)','cabezas',21],
 ['Gasto de suplementación: diaria × días × stock','USD',36,true],['Terminación intensiva a pasto','USD/cab/día',30],
 ['Días de terminación intensiva','días',31],['Gasto terminación intensiva: diaria × días × vendidos','USD',37,true],
 ['Costo nutrición / ingreso de nutrición','%',s=>s.inputs[41][0]],['Costo de compra y venta de nutrición','USD',35],
 ['Impuestos / venta de ganado','%',s=>s.inputs[40][0]],['Impuestos y tasas','USD',34],
 ['Administración / venta de ganado','%',s=>s.inputs[42][0]],['Gastos de administración','USD',38],
 ['Mantenimiento de establecimientos','USD',39],['Intereses del cronograma de deudas','USD',42],['TOTAL EGRESOS OPERATIVOS','USD',16,true]
];
