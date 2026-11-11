import { describe,it,expect } from 'vitest';
import { sampleConcerns,visibleConcerns,concernCounts,createConcern,addConcernReply,changeConcernStatus } from '../src/ui/concernsModel.js';
import { renderConcerns } from '../src/ui/concernsView.js';
import { navForRole } from '../src/ui/navigation.js';
const owner={id:'o',name:'Owner',role:'owner'},staff={id:'s',name:'Worker',role:'staff'};
const batches=[{batch_id:'b',batch_name:'Flock B'}];
const input={category:'Equipment',urgency:'Urgent',batchId:'b',text:'Water line leaking.'};
describe('device-only concern board',()=>{
 it('keeps sample problems explicitly separate from newly raised concerns',()=>{
  expect(concernCounts(sampleConcerns())).toEqual({Open:1,'In progress':1,Solved:1});
  expect(sampleConcerns().every(c=>c.sample)).toBe(true);
  const c=createConcern(input,{actor:staff,batches,id:'new',now:'2026-11-09T12:00:00Z'});
  expect(c).toMatchObject({sample:false,status:'Open',authorId:'s',by:'Worker',batchId:'b',batchName:'Flock B'});
 });
 it('rejects blank problems, unavailable batches and unsupported urgency',()=>{
  expect(()=>createConcern({...input,text:'  '},{actor:staff,batches})).toThrow('Describe');
  expect(()=>createConcern({...input,batchId:'other'},{actor:staff,batches})).toThrow('available batch');
  expect(()=>createConcern({...input,urgency:'critical'},{actor:staff,batches})).toThrow('Normal or Urgent');
 });
 it('does not allow non-image URLs as concern photos',()=>{
  expect(()=>createConcern({...input,photo:'javascript:alert(1)'},{actor:staff,batches})).toThrow('photo');
 });
 it('limits the staff list to their own concerns, without broadening the four-section menu',()=>{
  expect(visibleConcerns(sampleConcerns(),'staff','u-ana')).toHaveLength(2);
  expect(visibleConcerns(sampleConcerns(),'staff','unknown')).toEqual([]);
  const nav=navForRole('staff',true);expect(nav).toHaveLength(4);expect(nav.find(g=>g.key==='logbook').subs.some(s=>s.view==='concerns')).toBe(true);expect(nav.some(g=>g.key==='team')).toBe(false);
 });
 it('adds a reply without mutating the source concern and rejects other staff authors',()=>{
  const c=createConcern(input,{actor:staff,batches});const next=addConcernReply(c,'Checked the water line.',staff);
  expect(c.thread).toHaveLength(1);expect(next.thread).toHaveLength(2);expect(next.thread[1]).toMatchObject({by:'Worker',manager:false});
  expect(()=>addConcernReply(c,'Reply',{...staff,id:'other'})).toThrow('own concerns');
  expect(()=>addConcernReply(c,' ',owner)).toThrow('reply first');
 });
 it('allows only a manager to change status and preserves the reply history',()=>{
  const c=createConcern(input,{actor:staff,batches});expect(()=>changeConcernStatus(c,'Solved',staff)).toThrow('manager');
  const next=changeConcernStatus(c,'Solved',owner);expect(next.status).toBe('Solved');expect(c.status).toBe('Open');expect(next.thread).toEqual(c.thread);
 });
 it('uses the reference status filters and shows an empty detail for an empty filter',()=>{
  const html=renderConcerns([sampleConcerns()[0]],batches,{filter:'Solved'},owner);
  expect(html).toContain('No concerns here');expect(html).not.toContain('id="concern-detail-title"');expect(html).toContain('data-concern-filter="In progress"');
 });
 it('escapes concern text and makes local-only replies explicit',()=>{
  const c=createConcern({...input,text:'<script>alert(1)</script>'},{actor:staff,batches});const html=renderConcerns([c],batches,{},owner);
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('not sent to other farm users');
 });
});
