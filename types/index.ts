export type Period='Morning'|'Afternoon'|'Evening';
export type Status='todo'|'done'|'skipped';
export interface Task{id:string;title:string;time:string;minutes:number;period:Period;optional?:boolean;status:Status;minimum:string;steps:string[]}
export interface AuraState{name:string;onboarded:boolean;lowDemand:boolean;tasks:Task[];checkIn?:{capacity:string;sensory:string};valuesAction?:string;thought?:string;settings:{reducedMotion:boolean;highContrast:boolean;fontSize:number;gamification:boolean;notifications:boolean}}
