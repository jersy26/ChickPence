import { filterActive, localToday } from './calculations.js';
import { daysBetween } from './guidedQuestions.js';
import { buildPnlLedger, batchPerformanceThrough } from './pnlCalendar.js';
export const FARM_REPORTS=[['flock','Flock balance'],['health','Feed & mortality'],['sales','Sales & buyers'],['pnl','Recorded P&L']];
export function buildFarmReport(items=[],expenses=[],tab='flock',filters={}) {
  const end=filters.to||localToday(),start=filters.from||'',query=(filters.q||'').trim().toLowerCase();
  const period=date=>date && (!start||date>=start) && date<=end;
  const selected=items.filter(({batch})=>batch && !batch.deleted_at && batch.start_date<=end && (!start||!batch.end_date||batch.end_date>=start) && (!filters.status||batch.status===filters.status) && (!query||batch.batch_name.toLowerCase()===query));
  const ledger=buildPnlLedger(selected,expenses);
  if(tab==='sales') {
    const rows=[];
    for(const item of selected) for(const sale of filterActive(item.sales||[]).filter(s=>period(s.sale_date))) {
      const buyer=sale.buyer_name?.trim()||'Buyer not recorded';
      let row=rows.find(r=>r.batchId===item.batch.batch_id && r.buyer===buyer);
      if(!row){row={batchId:item.batch.batch_id,batch:item.batch.batch_name,buyer,heads:0,kg:0,revenue:0,sales:0};rows.push(row);}
      row.heads+=Number(sale.quantity_sold)||0;row.kg+=Number(sale.weight_kg)||0;row.revenue+=Math.round((Number(sale.total_amount)||0)*100);row.sales++;
    }
    return rows.map(r=>({...r,price:r.kg?r.revenue/100/r.kg:null})).sort((a,b)=>b.revenue-a.revenue);
  }
  return selected.map(item=>{
    const {batch}=item,through=batchPerformanceThrough(ledger,item,end);
    const feed=filterActive(item.feed||[]).filter(f=>period(f.entry_date)).reduce((s,f)=>s+(f.quantity_g!=null?Number(f.quantity_g)/1000:Number(f.quantity_kg)||0),0);
    const deaths=filterActive(item.mortality||[]).filter(m=>period(m.entry_date)).reduce((s,m)=>s+(Number(m.count)||0),0);
    const recorded=[...ledger.days.values()].filter(d=>period(d.date)).map(d=>d.batches.get(batch.batch_id)).filter(Boolean);
    const revenue=recorded.reduce((s,r)=>s+r.revenue,0),cost=recorded.reduce((s,r)=>s+r.cost,0);
    const mortalityRate=batch.initial_chick_count?through.mortality/Number(batch.initial_chick_count)*100:0;
    const warning=batch.mortality_threshold_pct!=null && mortalityRate>Number(batch.mortality_threshold_pct);
    const final=batch.status==='Closed' && batch.end_date && batch.end_date<=end;
    return {batchId:batch.batch_id,batch:batch.batch_name,status:batch.status,start:batch.start_date,age:daysBetween(batch.start_date,final?batch.end_date:end),initial:Number(batch.initial_chick_count)||0,live:through.live,sold:through.sold,totalDeaths:through.mortality,deaths,feed,mortalityRate,warning,threshold:batch.mortality_threshold_pct,revenue,cost,net:revenue-cost,margin:revenue?((revenue-cost)/revenue*100):null,final};
  });
}
