import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root=process.cwd(); const outDir=path.join(root,'.build','native');
const hostPath=path.join(outDir,process.platform==='win32'?'iat_native_host.exe':'iat_native_host');
const inputPath=path.join(root,'tests','fixtures','generated','core-v1.3-opacity-output.inp');
const firstPng=path.join(root,'tests','fixtures','generated','v1.4-preview-default-a.png');
const secondPng=path.join(root,'tests','fixtures','generated','v1.4-preview-default-b.png');
const lowPng=path.join(root,'tests','fixtures','generated','v1.4-preview-visibility-low.png');
const highPng=path.join(root,'tests','fixtures','generated','v1.4-preview-visibility-high.png');
const invalidFixture=path.join(root,'tests','fixtures','invalid','not-a-puppet.inp');
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';
const nativeEnv={...process.env,LD_LIBRARY_PATH:[outDir,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),DYLD_LIBRARY_PATH:[outDir,process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),PATH:[outDir,process.env.PATH].filter(Boolean).join(path.delimiter)};
function run(command,args,options={}){const result=spawnSync(command,args,{cwd:root,env:nativeEnv,encoding:'utf8',...options});if(result.error)throw result.error;return result;}
function requireSuccess(result,label){if(result.status!==0||result.stderr!==''){console.error(result.stderr||`${label} exited ${result.status}`);process.exit(result.status??1);}try{return JSON.parse(result.stdout);}catch(error){console.error(`${label} emitted invalid JSON: ${error}`);process.exit(1);}}
const visualGate=run(npmCommand,['run','v1.3:visual-controls:ci'],{stdio:'inherit',encoding:undefined});if(visualGate.status!==0)process.exit(visualGate.status??1);
const hostBuild=run('dub',['build','--root=native/host','--compiler=ldc2','--build=debug'],{stdio:'inherit',encoding:undefined});if(hostBuild.status!==0)process.exit(hostBuild.status??1);
for(const file of [firstPng,secondPng,lowPng,highPng])rmSync(file,{force:true});
const render=(file,values)=>requireSuccess(run(hostPath,['render-preview',inputPath,file,'256','256',...(values?[JSON.stringify(values)]:[])]),'preview render');
const first=render(firstPng); const second=render(secondPng);
const low=render(lowPng,{Visibility:[-1,0]}); const high=render(highPng,{Visibility:[1,0]});
for(const [metadata,file] of [[first,firstPng],[second,secondPng],[low,lowPng],[high,highPng]]){
 if(metadata?.kind!=='inochi2d-headless-preview'||metadata?.width!==256||metadata?.height!==256||metadata?.triangleCount<1||metadata?.coveredPixelSamples<1){console.error('preview metadata does not prove a non-empty real render');process.exit(1);}
 const bytes=readFileSync(file);if(bytes.length<=8||!bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))){console.error('preview output is not a PNG artifact');process.exit(1);}
}
if(low.appliedParameters?.Visibility?.[0]!==-1||high.appliedParameters?.Visibility?.[0]!==1){console.error('preview did not report the requested semantic parameter states');process.exit(1);}
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex'); const firstDigest=digest(firstPng),secondDigest=digest(secondPng),lowDigest=digest(lowPng),highDigest=digest(highPng);
if(firstDigest!==secondDigest){console.error(`headless preview is not deterministic: ${firstDigest} != ${secondDigest}`);process.exit(1);}
if(lowDigest===highDigest){console.error(`semantic preview states did not change rendered pixels: ${lowDigest}`);process.exit(1);}
const invalidState=run(hostPath,['render-preview',inputPath,path.join(root,'tests','fixtures','generated','v1.4-invalid-state.png'),'256','256',JSON.stringify({Visibility:[2,0]})]);
if(invalidState.status===0||invalidState.stderr.trim().length===0){console.error('out-of-range preview parameter state was not rejected');process.exit(1);}
const broken=run(hostPath,['render-preview',invalidFixture,path.join(root,'tests','fixtures','generated','v1.4-invalid.png'),'256','256']);
if(broken.status===0||broken.stdout!==''||broken.stderr.trim().length===0){console.error('broken preview input was not rejected');process.exit(1);}
console.log(JSON.stringify({ok:true,input:path.relative(root,inputPath),sha256:firstDigest,lowSha256:lowDigest,highSha256:highDigest,coveredPixelSamples:first.coveredPixelSamples,triangleCount:first.triangleCount,parameterStates:['Visibility=-1','Visibility=1']}));
