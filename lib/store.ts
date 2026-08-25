import {AuraState} from '@/types'; import {initialState} from './demo';
export const storageKey='aura-state-v1';
export function loadState():AuraState{if(typeof window==='undefined')return initialState;try{return {...initialState,...JSON.parse(localStorage.getItem(storageKey)||'{}')}}catch{return initialState}}
export function saveState(state:AuraState){if(typeof window!=='undefined')localStorage.setItem(storageKey,JSON.stringify(state))}
export const visibleTasks=(s:AuraState)=>s.lowDemand?s.tasks.filter(t=>!t.optional):s.tasks;
export const orderedTasks=(tasks:AuraState['tasks'])=>[...tasks].sort((a,b)=>a.time.localeCompare(b.time));
export const forDay=(tasks:AuraState['tasks'],_day:number)=>tasks;
