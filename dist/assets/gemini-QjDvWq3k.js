const M={firstName:"",lastName:"",email:"",phone:"",location:"",linkedinUrl:"",githubUrl:"",portfolioUrl:"",summary:"",experiences:[],education:[],skills:[]},Ae=["saved","applied","interviewing","offered","accepted","rejected","ghosted"],Y={corePitch:"",topStrengths:[],roleTargets:[],constraints:"",tone:"direct"},W={autoDetect:!1,theme:"dark",statelessMode:!1,providerConfig:{id:"ollama",model:"llama3.2",baseUrl:"http://localhost:11434"}},oe={async get(e){return(await chrome.storage.local.get(e))[e]??null},async set(e,t){await chrome.storage.local.set({[e]:t})},async remove(e){await chrome.storage.local.remove(e)}};let g=oe;async function te(){return(await x()).statelessMode}async function $e(){var e;return typeof chrome<"u"&&((e=chrome.storage)!=null&&e.session)&&await te()?(await chrome.storage.session.get("profile")).profile??M:await g.get("profile")??M}async function Se(e){var t;if(typeof chrome<"u"&&((t=chrome.storage)!=null&&t.session)&&await te()){await chrome.storage.session.set({profile:e}),await g.remove("profile");return}await g.set("profile",e)}async function Ee(e){var t;if(!(typeof chrome>"u"||!((t=chrome.storage)!=null&&t.session)))if(e){const s=await g.get("profile")??M;await chrome.storage.session.set({profile:s}),await g.remove("profile")}else{const a=(await chrome.storage.session.get("profile")).profile??M;await g.set("profile",a),await chrome.storage.session.remove("profile")}}async function V(){return await g.get("applications")??[]}async function z(e){await g.set("applications",e)}async function Re(e){const t=await V();t.push(e),await z(t)}async function Te(e,t){const s=await V(),a=s.findIndex(n=>n.id===e);a!==-1&&(s[a]={...s[a],...t},await z(s))}async function ke(e){const t=await V();await z(t.filter(s=>s.id!==e))}async function x(){const e=await g.get("settings")??W,t=e;if(!e.providerConfig&&t.ollamaUrl){const s=t.ollamaUrl;e.providerConfig={id:"ollama",model:"llama3.2",baseUrl:s},await g.set("settings",e)}return e.providerConfig||(e.providerConfig=W.providerConfig),e}async function ve(e){await g.set("settings",e)}async function Ue(){var t,s;if((await x()).statelessMode&&typeof chrome<"u"&&((t=chrome.storage)!=null&&t.session))return(await chrome.storage.session.get("voice")).voice??Y;try{if(typeof chrome<"u"&&((s=chrome.storage)!=null&&s.local))return(await chrome.storage.local.get("voice")).voice??Y}catch{}return Y}async function Ie(e){var s,a;if((await x()).statelessMode&&typeof chrome<"u"&&((s=chrome.storage)!=null&&s.session)){await chrome.storage.session.set({voice:e});return}try{if(typeof chrome<"u"&&((a=chrome.storage)!=null&&a.local)){await chrome.storage.local.set({voice:e});return}}catch{}}async function Oe(){var t,s;if((await x()).statelessMode&&typeof chrome<"u"&&((t=chrome.storage)!=null&&t.session))return(await chrome.storage.session.get("rawResume")).rawResume??"";try{if(typeof chrome<"u"&&((s=chrome.storage)!=null&&s.local))return(await chrome.storage.local.get("rawResume")).rawResume??""}catch{}return""}async function xe(e){var s,a;if((await x()).statelessMode&&typeof chrome<"u"&&((s=chrome.storage)!=null&&s.session)){await chrome.storage.session.set({rawResume:e});return}try{if(typeof chrome<"u"&&((a=chrome.storage)!=null&&a.local)){await chrome.storage.local.set({rawResume:e});return}}catch{}}async function Ce(){var e;try{if(typeof chrome<"u"&&((e=chrome.storage)!=null&&e.session))return(await chrome.storage.session.get("resumeDraft")).resumeDraft??null}catch{}return null}async function Ne(e){var t;try{typeof chrome<"u"&&((t=chrome.storage)!=null&&t.session)&&await chrome.storage.session.set({resumeDraft:e})}catch{}}async function Pe(){var e;try{typeof chrome<"u"&&((e=chrome.storage)!=null&&e.session)&&await chrome.storage.session.remove("resumeDraft")}catch{}}const H=100;async function ie(){return await g.get("fillRuns")??[]}async function je(e){const t=await ie();t.unshift(e),t.length>H&&(t.length=H),await g.set("fillRuns",t)}const Q=30;async function ce(){return await g.get("smartApplyRuns")??[]}async function Le(e){const t=await ce();t.unshift(e),t.length>Q&&(t.length=Q),await g.set("smartApplyRuns",t)}const Z=20;async function le(){return await g.get("generationRuns")??[]}async function Me(e){const t=await le();t.unshift(e),t.length>Z&&(t.length=Z),await g.set("generationRuns",t)}function De(e){const{url:t,company:s,role:a,detectedFields:n,fillResults:o,pageMeta:c}=e,i=n.filter(l=>l.matchedField!==null).length,u=o.filter(l=>l.success).length,d=o.filter(l=>!l.success&&!l.manualRequired).length,r=o.filter(l=>l.manualRequired).length,w=o.reduce((l,m)=>l+(m.durationMs??0),0),p={};for(const l of o)l.reason&&(p[l.reason]=(p[l.reason]??0)+1);let h="";try{h=new URL(t).hostname}catch{}return{id:crypto.randomUUID(),timestamp:new Date().toISOString(),url:t,company:s,role:a,pageMeta:{title:(c==null?void 0:c.title)??"",hostname:h,stepIndex:(c==null?void 0:c.stepIndex)??0,stepLabel:c==null?void 0:c.stepLabel},detectedFields:n,fillResults:o,stats:{totalFields:n.length,matched:i,filled:u,failed:d,manualRequired:r,skipped:n.length-i,reasonBreakdown:p},totalDurationMs:w}}const D=new Map,se=new Map;function F(e,t){D.set(e.id,e),se.set(e.id,t)}function Fe(e){const t=D.get(e);if(!t)throw new Error(`Unknown provider: "${e}". Available: ${[...D.keys()].join(", ")}`);return t}function qe(){return[...D.entries()].map(([e,t])=>{const s=se.get(e);return{id:e,name:t.name,requiresApiKey:t.requiresApiKey,defaultModel:s.defaultModel,models:s.models,defaultBaseUrl:s.defaultBaseUrl}})}function q(e,t,s,a){const n=e.questions.length>0?e.questions.map((i,u)=>`    { "label": "${i.label.replace(/"/g,'\\"')}", "answer": "your answer for question ${u+1}" }`).join(`,
`):'    { "label": "No additional questions", "answer": "" }',o=X(s),c=a?`
Candidate's Existing Resume (THIS IS YOUR PRIMARY SOURCE — it contains the candidate's real companies, titles, accomplishments, and skills. Use it as the ground truth for all answers):
${a}
`:"";return`You are helping a candidate apply for a job. Respond ONLY with valid JSON, no other text.

Job Title: ${e.title}
Company: ${e.company}

Job Description (truncated):
${e.description}
${o}${c}
Candidate Profile:
${JSON.stringify(t,null,2)}

Generate a JSON object with these exact keys:
{
  "summary": "3-4 sentences about this candidate's relevant experience for THIS role. Use their REAL job titles, companies, and skills from the resume/profile.",
  "whyCompany": "A concise paragraph on why this company/role is compelling based on the job description. Reference SPECIFIC things from the JD — product names, tech stack, team mission. Do NOT write generic enthusiasm.",
  "answers": [
${n}
  ]
}

STRICT RULES — failure to follow these will make the output useless:
1. YOUR PRIMARY SOURCE is the existing resume text (if provided). It contains the candidate's real companies, titles, accomplishments, and skills. Use it as ground truth.
2. ONLY reference experience, skills, companies, and job titles that ACTUALLY EXIST in the resume or candidate profile above.
3. NEVER use bracket placeholders like [project], [company], [technology], [X years], [specific example]. If you don't have specific information, write a general but honest statement instead.
4. NEVER invent job titles, companies, metrics (percentages, dollar amounts), or achievements not found in the resume/profile. It is BETTER to be vague than to fabricate.
5. For open-ended questions ("describe something you've built", "tell us about yourself", etc.), draw from the candidate's REAL experiences in the resume. Reference actual companies (e.g. Roblox, Walmart, etc.) and real projects they describe.
6. For "additional information" or "cover letter" fields, write a brief tailored paragraph connecting the candidate's real background to this specific role. Reference specific details from the job description.
7. Be direct. No fluff. BANNED PHRASES: "I am excited to apply", "I believe I would be a great fit", "I am enthusiastic about joining", "fostering a culture of innovation", "passionate about". Write like a real human, not a form letter.
8. Keep answers concise but substantive — 2-4 sentences per answer unless the question asks for more.
9. Reference specific things from the job description (product names, tech stack, team, mission) to show the application is tailored — do NOT just repeat the company name with generic praise.`}function _(e){let t=e.trim();t=t.replace(/^```(?:json)?\s*\n?/i,"").replace(/\n?```\s*$/i,"");try{const a=JSON.parse(t);if(a.summary&&a.whyCompany&&Array.isArray(a.answers))return a}catch{}const s=t.match(/\{[\s\S]*\}/);if(s)try{const a=JSON.parse(s[0]);if(a.summary&&a.whyCompany&&Array.isArray(a.answers))return a}catch{}return null}function X(e){return!e||!e.corePitch?"":`
Candidate Voice & Preferences:
- Core Pitch: ${e.corePitch}${e.topStrengths.length>0?`
- Top Strengths: ${e.topStrengths.join(", ")}`:""}${e.roleTargets.length>0?`
- Target Roles: ${e.roleTargets.join(", ")}`:""}${e.constraints?`
- Constraints: ${e.constraints}`:""}
- Tone: Write in a ${e.tone} tone.

Use the candidate's own words from "Core Pitch" as the foundation. Don't be generic.
`}function J(e,t,s,a,n){const o=X(s),c=a?`
Candidate's Existing Resume (use as primary source material — preserve accomplishments and phrasing where relevant):
${a}
`:"",i=n?`
User Notes / Feedback:
${n}
`:"";return`You are creating a tailored resume for a job application. Respond ONLY with markdown, no other text.

Job Title: ${e.title}
Company: ${e.company}

Job Description (truncated):
${e.description}
${o}
Candidate Profile (structured data):
${JSON.stringify(t,null,2)}
${c}${i}
Generate a professional resume in markdown format with these sections:

# ${t.firstName} ${t.lastName}
${t.email}${t.phone?` | ${t.phone}`:""}${t.linkedinUrl?` | ${t.linkedinUrl}`:""}${t.location?` | ${t.location}`:""}

## Summary
2-3 sentences tailored to this role, using the candidate's REAL experience.

## Experience
List ONLY the experiences from the source material. Reword bullet points to emphasize skills matching the job.

## Education
List ONLY the education entries from the source material. If none exist, OMIT this section entirely.

## Skills
Skills from the source material relevant to this job, prioritized.

STRICT RULES — these are non-negotiable:
1. YOUR PRIMARY SOURCE IS THE EXISTING RESUME TEXT (if provided). It contains the candidate's real companies, titles, accomplishments, and education. Use it verbatim where appropriate, rewording only to tailor for this role.
2. The structured profile JSON is a secondary reference. If the existing resume has richer detail than the JSON, PREFER the resume text.
3. ONLY use experience, education, skills, companies, and job titles that ACTUALLY EXIST in the source material. Count the experiences — your resume must have exactly the same ones, not more.
4. NEVER invent or fabricate metrics (percentages, dollar amounts, time savings). If the source material doesn't include a metric, don't add one. "Improved performance" is fine without "by 20%".
5. NEVER invent companies, job titles, or projects not in the source material.
6. NEVER use bracket placeholders like [project], [company], [X%], [University Name]. Everything must be concrete text from the source material.
7. If education is empty in ALL source material, do NOT write "None listed" or make up education — just skip the Education section entirely.
8. Keep to 1 page equivalent (roughly 400-600 words).
9. It is BETTER to write fewer, honest bullet points than to pad with fabricated achievements. Quality over quantity.
10. If the candidate voice is provided, reflect that tone in the writing.
11. Do NOT append any commentary, notes, explanation, or meta-text after the resume. Your response must end with resume content — nothing else.`}function K(e,t,s,a,n){const o=X(s),c=a?`
Candidate's Resume (reference for specific accomplishments and details):
${a}
`:"",i=n?`
User Notes / Feedback:
${n}
`:"";return`You are writing a cover letter for a job application. Respond ONLY with markdown, no other text.

Job Title: ${e.title}
Company: ${e.company}

Job Description (truncated):
${e.description}
${o}
Candidate Profile (structured data):
${JSON.stringify(t,null,2)}
${c}${i}
Write a professional cover letter in markdown with this structure:

**Paragraph 1 — Opening:** Start by referencing something SPECIFIC from the job description — a product feature, a technical challenge, a company mission statement. Then connect it to why you're a fit. Do NOT open with "I am writing to express my interest" or "I am excited to apply" — start with substance.

**Paragraph 2 — Body:** Connect 2-3 of the candidate's most relevant experiences to the specific requirements in the job description. Name real companies, real technologies, real projects from the resume/profile. For each point, tie it to a specific requirement from the JD.

**Paragraph 3 — Closing:** Brief, confident close with a call to action.

STRICT RULES:
1. YOUR PRIMARY SOURCE IS THE EXISTING RESUME TEXT (if provided). It contains the candidate's real companies, titles, and accomplishments. The structured JSON is a secondary reference.
2. ONLY reference experience, skills, and achievements that ACTUALLY EXIST in the source material.
3. NEVER invent metrics (percentages, dollar amounts, time savings). If the source material doesn't include a metric, don't add one.
4. NEVER invent companies, job titles, or projects not in the source material.
5. NEVER use bracket placeholders like [project], [company], [specific example].
6. Reference specific things from the JD — product names, tech stack mentioned, team descriptions, mission statements. Show you read it.
7. Keep it under 350 words — concise and impactful.
8. BANNED PHRASES: "I am writing to express my interest", "I am excited to apply", "I believe I would be a great fit", "I am confident that", "thrilled to apply", "passionate about". These are empty filler. Start with substance instead.
9. Address it to "Dear Hiring Manager," unless the job description names a specific person.
10. Sign off with the candidate's name: ${t.firstName} ${t.lastName}.
11. If user notes/feedback are provided, incorporate them into the letter.
12. Do NOT append any commentary, notes, explanation, or meta-text after the cover letter. End with the candidate's name — nothing else.`}function S(e){let t=e.trim();return t?(t=t.replace(/^```(?:markdown|md)?\s*\n?/i,"").replace(/\n?```\s*$/i,""),t=de(t),t.trim()||null):null}const ue=[/this resume/i,/this cover letter/i,/adheres to/i,/provided guidelines/i,/source material/i,/as instructed/i,/as requested/i,/i have ensured/i,/i have followed/i,/i have maintained/i,/i've ensured/i,/i've followed/i,/i've maintained/i,/note:/i,/please note/i,/the above/i,/no fabricat/i,/maintains? a professional/i,/emphasiz(?:es?|ing) accomplishments/i,/existing (?:resume|profile|source)/i,/real (?:companies|job titles)/i];function pe(e){const t=e.trimStart();return t.startsWith("#")||t.startsWith("-")||t.startsWith("*")||t.startsWith("|")||/^\*\*/.test(t)||/^---/.test(t)}function de(e){const t=e.split(/\n\s*\n/);let s=t.length-1;for(;s>=0;){const a=t[s].trim();if(!a){s--;continue}if(a.split(`
`).some(i=>pe(i)))break;if(ue.some(i=>i.test(a)))s--;else break}return s<0?e:t.slice(0,s+1).join(`

`)}function me(e,t){return e.questions.map((s,a)=>{var n;return{label:s.label,selectorCandidates:s.selectorCandidates,answer:((n=t.answers[a])==null?void 0:n.answer)??""}})}function B(e,t,s,a,n){return{summary:t.summary,whyCompany:t.whyCompany,answers:me(e,t),model:s,durationMs:n,promptChars:a}}function _e(e,t){if(t.length>200)return!1;const s=e.experiences.length>0,a=e.skills.length>0,n=e.summary.trim().length>20;return[!s,!a,!n].filter(Boolean).length>=2}function Je(e,t,s){const a=s?`
Candidate's Existing Resume:
${s}
`:"";return`You are analyzing a candidate's profile to identify missing information needed for a strong job application. Respond ONLY with valid JSON, no other text.

Job Title: ${t.title}
Company: ${t.company}

Job Description (truncated):
${t.description.slice(0,6e3)}

Candidate Profile:
${JSON.stringify(e,null,2)}
${a}
Analyze this profile and identify what critical information is MISSING or too sparse to create a strong, tailored resume for this specific role.

Respond with this JSON format:
{
  "questions": [
    {
      "id": "unique_id",
      "field": "summary" | "experiences" | "education" | "skills" | "other",
      "question": "A specific question to ask the candidate",
      "placeholder": "Example of what a good answer looks like",
      "inputType": "text" | "textarea"
    }
  ]
}

RULES:
1. Maximum 5 questions. Fewer is better — only ask about CRITICAL gaps.
2. If the profile + resume have enough data for this role, return: {"questions": []}
3. Questions must be SPECIFIC to this role and JD — not generic.
   - BAD: "What are your skills?"
   - GOOD: "Do you have experience with contract analysis AI or legal tech platforms?"
4. Focus on gaps that would cause hallucination:
   - Missing work experience details (no bullet points for a role)
   - Missing skills that the JD specifically requires
   - No education listed when the role requires a degree
   - Summary is empty or too generic
5. For "field", use:
   - "summary" — if the candidate needs a professional summary
   - "experiences" — if experience details are too sparse
   - "education" — if education is missing
   - "skills" — if critical skills are missing
   - "other" — for JD-specific questions that don't map to a profile field
6. Use "textarea" for open-ended answers, "text" for short answers (skills, education name, etc.)`}function Ke(e){let t=e.trim();t=t.replace(/^```(?:json)?\s*\n?/i,"").replace(/\n?```\s*$/i,"");try{const a=JSON.parse(t);if(Array.isArray(a.questions))return ee(a.questions)}catch{}const s=t.match(/\{[\s\S]*\}/);if(s)try{const a=JSON.parse(s[0]);if(Array.isArray(a.questions))return ee(a.questions)}catch{}return[]}function ee(e){const t=new Set(["summary","experiences","education","skills","other"]);return e.filter(s=>typeof s=="object"&&s!==null&&typeof s.question=="string").slice(0,5).map((s,a)=>({id:typeof s.id=="string"?s.id:`gap_${a}`,field:t.has(s.field)?s.field:"other",question:s.question,placeholder:typeof s.placeholder=="string"?s.placeholder:"",inputType:s.inputType==="text"?"text":"textarea"}))}const A="http://localhost:11434",E="llama3.2",C=18e4;async function he(e=A){try{return(await fetch(`${e}/api/tags`,{signal:AbortSignal.timeout(3e3)})).ok}catch{return!1}}async function fe(e=A){try{return((await(await fetch(`${e}/api/tags`,{signal:AbortSignal.timeout(5e3)})).json()).models??[]).map(a=>a.name)}catch{return[]}}async function N(e,t){const s=await fetch(`${t.baseUrl}/api/generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:t.model,prompt:e,stream:!1}),signal:AbortSignal.timeout(t.timeout)});if(!s.ok)throw new Error(`Ollama error: ${s.status} ${s.statusText}`);return(await s.json()).response??""}const we={id:"ollama",name:"Ollama (Local)",requiresApiKey:!1,async generateApplication(e,t,s,a,n){const o=s.baseUrl??A,c=s.model||E,i=s.timeout??C,u=q(e,t,a,n),d=performance.now(),r=await N(u,{baseUrl:o,model:c,timeout:i}),w=Math.round(performance.now()-d),p=_(r);if(!p)throw new Error(`Failed to parse LLM response. Raw output:
${r.slice(0,500)}`);return B(e,p,c,u.length,w)},async generateResume(e,t,s,a,n,o){const c=s.baseUrl??A,i=s.model||E,u=s.timeout??C,d=J(e,t,a,n,o),r=await N(d,{baseUrl:c,model:i,timeout:u}),w=S(r);if(!w)throw new Error(`Failed to parse resume response. Raw output:
${r.slice(0,500)}`);return{content:w,model:i}},async generateCoverLetter(e,t,s,a,n,o){const c=s.baseUrl??A,i=s.model||E,u=s.timeout??C,d=K(e,t,a,n,o),r=await N(d,{baseUrl:c,model:i,timeout:u}),w=S(r);if(!w)throw new Error(`Failed to parse cover letter response. Raw output:
${r.slice(0,500)}`);return{content:w,model:i}},async rawGenerate(e,t){const s=t.baseUrl??A,a=t.model||E,n=t.timeout??C;return N(e,{baseUrl:s,model:a,timeout:n})},async isAvailable(e){return he(e.baseUrl??A)},async listModels(e){return fe(e.baseUrl??A)}};F(we,{defaultModel:E,models:[E],defaultBaseUrl:A});const U="gpt-4o-mini",R="https://api.openai.com",P=18e4,ae=["gpt-4o","gpt-4o-mini","gpt-4.1-mini","gpt-4.1-nano"],ye={id:"openai",name:"OpenAI",requiresApiKey:!0,async generateApplication(e,t,s,a,n){var m,f,y;if(!s.apiKey)throw new Error("OpenAI requires an API key. Add one in Settings.");const o=s.baseUrl??R,c=s.model||U,i=s.timeout??P,u=q(e,t,a,n),d=performance.now(),r=await fetch(`${o}/v1/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${s.apiKey}`},body:JSON.stringify({model:c,messages:[{role:"user",content:u}],response_format:{type:"json_object"},temperature:.7}),signal:AbortSignal.timeout(i)});if(!r.ok){const b=await r.text().catch(()=>"");throw r.status===401?new Error("OpenAI error: 401 Unauthorized — check your API key"):r.status===429?new Error("OpenAI error: 429 Too Many Requests — rate limited"):new Error(`OpenAI error: ${r.status} ${r.statusText}${b?` — ${b.slice(0,200)}`:""}`)}const p=((y=(f=(m=(await r.json()).choices)==null?void 0:m[0])==null?void 0:f.message)==null?void 0:y.content)??"",h=Math.round(performance.now()-d),l=_(p);if(!l)throw new Error(`Failed to parse OpenAI response. Raw output:
${p.slice(0,500)}`);return B(e,l,c,u.length,h)},async generateResume(e,t,s,a,n,o){var l,m,f;if(!s.apiKey)throw new Error("OpenAI requires an API key. Add one in Settings.");const c=s.baseUrl??R,i=s.model||U,u=s.timeout??P,d=J(e,t,a,n,o),r=await fetch(`${c}/v1/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${s.apiKey}`},body:JSON.stringify({model:i,messages:[{role:"user",content:d}],temperature:.7}),signal:AbortSignal.timeout(u)});if(!r.ok){const y=await r.text().catch(()=>"");throw new Error(`OpenAI error: ${r.status} ${r.statusText}${y?` — ${y.slice(0,200)}`:""}`)}const p=((f=(m=(l=(await r.json()).choices)==null?void 0:l[0])==null?void 0:m.message)==null?void 0:f.content)??"",h=S(p);if(!h)throw new Error(`Failed to parse OpenAI resume response. Raw output:
${p.slice(0,500)}`);return{content:h,model:i}},async generateCoverLetter(e,t,s,a,n,o){var l,m,f;if(!s.apiKey)throw new Error("OpenAI requires an API key. Add one in Settings.");const c=s.baseUrl??R,i=s.model||U,u=s.timeout??P,d=K(e,t,a,n,o),r=await fetch(`${c}/v1/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${s.apiKey}`},body:JSON.stringify({model:i,messages:[{role:"user",content:d}],temperature:.7}),signal:AbortSignal.timeout(u)});if(!r.ok){const y=await r.text().catch(()=>"");throw new Error(`OpenAI error: ${r.status} ${r.statusText}${y?` — ${y.slice(0,200)}`:""}`)}const p=((f=(m=(l=(await r.json()).choices)==null?void 0:l[0])==null?void 0:m.message)==null?void 0:f.content)??"",h=S(p);if(!h)throw new Error(`Failed to parse OpenAI cover letter response. Raw output:
${p.slice(0,500)}`);return{content:h,model:i}},async rawGenerate(e,t){var i,u,d;if(!t.apiKey)throw new Error("OpenAI requires an API key.");const s=t.baseUrl??R,a=t.model||U,n=t.timeout??P,o=await fetch(`${s}/v1/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${t.apiKey}`},body:JSON.stringify({model:a,messages:[{role:"user",content:e}],temperature:.7}),signal:AbortSignal.timeout(n)});if(!o.ok){const r=await o.text().catch(()=>"");throw new Error(`OpenAI error: ${o.status}${r?` — ${r.slice(0,200)}`:""}`)}return((d=(u=(i=(await o.json()).choices)==null?void 0:i[0])==null?void 0:u.message)==null?void 0:d.content)??""},async isAvailable(e){if(!e.apiKey)return!1;try{const t=e.baseUrl??R;return(await fetch(`${t}/v1/models`,{headers:{Authorization:`Bearer ${e.apiKey}`},signal:AbortSignal.timeout(5e3)})).ok}catch{return!1}},async listModels(e){return ae}};F(ye,{defaultModel:U,models:ae});const I="claude-sonnet-4-20250514",T="https://api.anthropic.com",j=18e4,k="2023-06-01",re=["claude-sonnet-4-20250514","claude-haiku-4-20250414"],ge={id:"anthropic",name:"Anthropic",requiresApiKey:!0,async generateApplication(e,t,s,a,n){var m,f;if(!s.apiKey)throw new Error("Anthropic requires an API key. Add one in Settings.");const o=s.baseUrl??T,c=s.model||I,i=s.timeout??j,u=q(e,t,a,n),d=performance.now(),r=await fetch(`${o}/v1/messages`,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":s.apiKey,"anthropic-version":k,"anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:c,max_tokens:2048,messages:[{role:"user",content:u}]}),signal:AbortSignal.timeout(i)});if(!r.ok){const y=await r.text().catch(()=>"");throw r.status===401?new Error("Anthropic error: 401 Unauthorized — check your API key"):r.status===429?new Error("Anthropic error: 429 Too Many Requests — rate limited"):new Error(`Anthropic error: ${r.status} ${r.statusText}${y?` — ${y.slice(0,200)}`:""}`)}const p=((f=(m=(await r.json()).content)==null?void 0:m[0])==null?void 0:f.text)??"",h=Math.round(performance.now()-d),l=_(p);if(!l)throw new Error(`Failed to parse Anthropic response. Raw output:
${p.slice(0,500)}`);return B(e,l,c,u.length,h)},async generateResume(e,t,s,a,n,o){var l,m;if(!s.apiKey)throw new Error("Anthropic requires an API key. Add one in Settings.");const c=s.baseUrl??T,i=s.model||I,u=s.timeout??j,d=J(e,t,a,n,o),r=await fetch(`${c}/v1/messages`,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":s.apiKey,"anthropic-version":k,"anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:i,max_tokens:2048,messages:[{role:"user",content:d}]}),signal:AbortSignal.timeout(u)});if(!r.ok){const f=await r.text().catch(()=>"");throw new Error(`Anthropic error: ${r.status} ${r.statusText}${f?` — ${f.slice(0,200)}`:""}`)}const p=((m=(l=(await r.json()).content)==null?void 0:l[0])==null?void 0:m.text)??"",h=S(p);if(!h)throw new Error(`Failed to parse Anthropic resume response. Raw output:
${p.slice(0,500)}`);return{content:h,model:i}},async generateCoverLetter(e,t,s,a,n,o){var l,m;if(!s.apiKey)throw new Error("Anthropic requires an API key. Add one in Settings.");const c=s.baseUrl??T,i=s.model||I,u=s.timeout??j,d=K(e,t,a,n,o),r=await fetch(`${c}/v1/messages`,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":s.apiKey,"anthropic-version":k,"anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:i,max_tokens:2048,messages:[{role:"user",content:d}]}),signal:AbortSignal.timeout(u)});if(!r.ok){const f=await r.text().catch(()=>"");throw new Error(`Anthropic error: ${r.status} ${r.statusText}${f?` — ${f.slice(0,200)}`:""}`)}const p=((m=(l=(await r.json()).content)==null?void 0:l[0])==null?void 0:m.text)??"",h=S(p);if(!h)throw new Error(`Failed to parse Anthropic cover letter response. Raw output:
${p.slice(0,500)}`);return{content:h,model:i}},async rawGenerate(e,t){var i,u;if(!t.apiKey)throw new Error("Anthropic requires an API key.");const s=t.baseUrl??T,a=t.model||I,n=t.timeout??j,o=await fetch(`${s}/v1/messages`,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":t.apiKey,"anthropic-version":k,"anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:a,max_tokens:2048,messages:[{role:"user",content:e}]}),signal:AbortSignal.timeout(n)});if(!o.ok){const d=await o.text().catch(()=>"");throw new Error(`Anthropic error: ${o.status}${d?` — ${d.slice(0,200)}`:""}`)}return((u=(i=(await o.json()).content)==null?void 0:i[0])==null?void 0:u.text)??""},async isAvailable(e){if(!e.apiKey)return!1;try{const t=e.baseUrl??T;return(await fetch(`${t}/v1/messages`,{method:"POST",headers:{"Content-Type":"application/json","x-api-key":e.apiKey,"anthropic-version":k,"anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-haiku-4-20250414",max_tokens:1,messages:[{role:"user",content:"hi"}]}),signal:AbortSignal.timeout(1e4)})).ok}catch{return!1}},async listModels(e){return re}};F(ge,{defaultModel:I,models:re});const O="gemini-2.0-flash",v="https://generativelanguage.googleapis.com",L=18e4,ne=["gemini-2.0-flash","gemini-2.5-flash-preview-05-20"],be={id:"gemini",name:"Google Gemini",requiresApiKey:!0,async generateApplication(e,t,s,a,n){var m,f,y,b,$;if(!s.apiKey)throw new Error("Gemini requires an API key. Add one in Settings.");const o=s.baseUrl??v,c=s.model||O,i=s.timeout??L,u=q(e,t,a,n),d=performance.now(),r=await fetch(`${o}/v1beta/models/${c}:generateContent?key=${s.apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:u}]}],generationConfig:{responseMimeType:"application/json",temperature:.7}}),signal:AbortSignal.timeout(i)});if(!r.ok){const G=await r.text().catch(()=>"");throw r.status===400&&G.includes("API_KEY_INVALID")?new Error("Gemini error: Invalid API key — check your API key"):r.status===429?new Error("Gemini error: 429 Too Many Requests — rate limited"):new Error(`Gemini error: ${r.status} ${r.statusText}${G?` — ${G.slice(0,200)}`:""}`)}const p=(($=(b=(y=(f=(m=(await r.json()).candidates)==null?void 0:m[0])==null?void 0:f.content)==null?void 0:y.parts)==null?void 0:b[0])==null?void 0:$.text)??"",h=Math.round(performance.now()-d),l=_(p);if(!l)throw new Error(`Failed to parse Gemini response. Raw output:
${p.slice(0,500)}`);return B(e,l,c,u.length,h)},async generateResume(e,t,s,a,n,o){var l,m,f,y,b;if(!s.apiKey)throw new Error("Gemini requires an API key. Add one in Settings.");const c=s.baseUrl??v,i=s.model||O,u=s.timeout??L,d=J(e,t,a,n,o),r=await fetch(`${c}/v1beta/models/${i}:generateContent?key=${s.apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:d}]}],generationConfig:{temperature:.7}}),signal:AbortSignal.timeout(u)});if(!r.ok){const $=await r.text().catch(()=>"");throw new Error(`Gemini error: ${r.status} ${r.statusText}${$?` — ${$.slice(0,200)}`:""}`)}const p=((b=(y=(f=(m=(l=(await r.json()).candidates)==null?void 0:l[0])==null?void 0:m.content)==null?void 0:f.parts)==null?void 0:y[0])==null?void 0:b.text)??"",h=S(p);if(!h)throw new Error(`Failed to parse Gemini resume response. Raw output:
${p.slice(0,500)}`);return{content:h,model:i}},async generateCoverLetter(e,t,s,a,n,o){var l,m,f,y,b;if(!s.apiKey)throw new Error("Gemini requires an API key. Add one in Settings.");const c=s.baseUrl??v,i=s.model||O,u=s.timeout??L,d=K(e,t,a,n,o),r=await fetch(`${c}/v1beta/models/${i}:generateContent?key=${s.apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:d}]}],generationConfig:{temperature:.7}}),signal:AbortSignal.timeout(u)});if(!r.ok){const $=await r.text().catch(()=>"");throw new Error(`Gemini error: ${r.status} ${r.statusText}${$?` — ${$.slice(0,200)}`:""}`)}const p=((b=(y=(f=(m=(l=(await r.json()).candidates)==null?void 0:l[0])==null?void 0:m.content)==null?void 0:f.parts)==null?void 0:y[0])==null?void 0:b.text)??"",h=S(p);if(!h)throw new Error(`Failed to parse Gemini cover letter response. Raw output:
${p.slice(0,500)}`);return{content:h,model:i}},async rawGenerate(e,t){var i,u,d,r,w;if(!t.apiKey)throw new Error("Gemini requires an API key.");const s=t.baseUrl??v,a=t.model||O,n=t.timeout??L,o=await fetch(`${s}/v1beta/models/${a}:generateContent?key=${t.apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:e}]}],generationConfig:{temperature:.7}}),signal:AbortSignal.timeout(n)});if(!o.ok){const p=await o.text().catch(()=>"");throw new Error(`Gemini error: ${o.status}${p?` — ${p.slice(0,200)}`:""}`)}return((w=(r=(d=(u=(i=(await o.json()).candidates)==null?void 0:i[0])==null?void 0:u.content)==null?void 0:d.parts)==null?void 0:r[0])==null?void 0:w.text)??""},async isAvailable(e){if(!e.apiKey)return!1;try{const t=e.baseUrl??v;return(await fetch(`${t}/v1beta/models?key=${e.apiKey}`,{signal:AbortSignal.timeout(5e3)})).ok}catch{return!1}},async listModels(e){return ne}};F(be,{defaultModel:O,models:ne});export{Ae as A,ie as B,ce as C,W as D,M as E,le as F,V as a,Je as b,Re as c,ke as d,$e as e,De as f,Fe as g,x as h,Ue as i,Oe as j,Le as k,_e as l,Me as m,Se as n,qe as o,Ke as p,Y as q,xe as r,je as s,ve as t,Te as u,Ee as v,Ie as w,Ce as x,Pe as y,Ne as z};
