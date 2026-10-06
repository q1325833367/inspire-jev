import {Agent} from './agent.mjs';
// A desktop skill binds only the host-provided handle; it never attaches raw CDP.
export async function bindDesktop(tab,options={}){const agent=await Agent.create({host:'gpt-sidebar',...options});const sessionId=agent.sessions.bindDesktop(tab,options);return{agent,sessionId};}
