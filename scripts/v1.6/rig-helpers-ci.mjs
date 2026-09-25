import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root=process.cwd();
const outDir=path.join(root,'.build','native');
const hostPath=path.join(outDir,process.platform==='win32'?'iat_native_host.exe':'iat_native_host');
const inputPath=path.join(root,'tests','fixtures','generated','core-v1.3-opacity-output.inp');
const outputPath=path.join(root,'tests','fixtures','generated','v1.6-rig-helper-output.inp');
const lowPng=path.join(root,'tests','fixtures','generated','v1.6-rig-helper-low.png');
const highPng=path.join(root,'tests','fixtures','generated','v1.6-rig-helper-high.png');
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';
const env={...process.env,LD_LIBRARY_PATH:[outDir,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),DYLD_LIBRARY_PATH:[outDir,process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),PATH:[outDir,process.env.PATH].filter(Boolean).join(path.delimiter)};
function run(command,args,options={}){const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',...options});if(r.error)throw r.error;return r;}
function jsonSuccess(r,label){if(r.status!==0){console.error(r.stderr||`${label} exited ${r.status}`);process.exit(r.status??1);}try{return JSON.parse(r.stdout);}catch(e){console.error(`${label} emitted invalid JSON: ${e}`);process.exit(1);}}
const prior=run(npmCommand,['run','v1.4:preview:ci'],{stdio:'inherit',encoding:undefined});if(prior.status!==0)process.exit(prior.status??1);
const hostBuild=run('dub',['build','--root=native/host','--compiler=ldc2','--build=debug'],{stdio:'inherit',encoding:undefined});if(hostBuild.status!==0)process.exit(hostBuild.status??1);
const coreBuild=run(npmCommand,['run','core:build'],{stdio:'inherit',encoding:undefined});if(coreBuild.status!==0)process.exit(coreBuild.status??1);
const {compileTwoAxisTranslationRig}=await import('../../packages/core/dist/index.js');
const recipe={parameterNames:{x:'Head X',y:'Head Y'},targets:[{path:'/Root/Face',x:8,y:5}]};
const operations=compileTwoAxisTranslationRig(recipe);
if(operations.length!==4){console.error(`expected recipe to compile to 4 ordinary semantic operations, got ${operations.length}`);process.exit(1);}
if(JSON.stringify(operations)!==JSON.stringify(compileTwoAxisTranslationRig(recipe))){console.error('rig recipe compilation is not deterministic');process.exit(1);}
rmSync(outputPath,{force:true});rmSync(lowPng,{force:true});rmSync(highPng,{force:true});
const authored=jsonSuccess(run(hostPath,['edit-visual',inputPath,outputPath,JSON.stringify(operations)]),'rig helper authoring');
for(const name of ['Head X','Head Y']){const p=authored.parameters?.find(x=>x.name===name);if(!p||p.dimensions!==1){console.error(`missing authored parameter ${name}`);process.exit(1);}}
const reopened=jsonSuccess(run(hostPath,['inspect',outputPath]),'rig helper reopen inspection');
for(const [name,property] of [['Head X','transform.t.x'],['Head Y','transform.t.y']]){
 const p=reopened.parameters?.find(x=>x.name===name);
 if(!p||!p.bindings?.some(b=>b.targetPath==='/Root/Face'&&b.property===property)){console.error(`reopened semantic binding mismatch for ${name}`);process.exit(1);}
}
const render=(file,values)=>jsonSuccess(run(hostPath,['render-preview',outputPath,file,'256','256',JSON.stringify(values)]),'rig helper preview');
const low=render(lowPng,{'Head X':[-1,0],'Head Y':[-1,0]});
const high=render(highPng,{'Head X':[1,0],'Head Y':[1,0]});
for(const metadata of [low,high])if(metadata?.kind!=='inochi2d-headless-preview'||metadata?.coveredPixelSamples<1){console.error('rig helper preview did not prove a non-empty render');process.exit(1);}
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
if(digest(lowPng)===digest(highPng)){console.error('rig helper extreme states did not change rendered pixels');process.exit(1);}
run(npmCommand,['run','creator:materialize'],{stdio:'inherit',encoding:undefined});
const creator=run(process.execPath,['scripts/creator/launch-roundtrip.mjs','--open-only','tests/fixtures/generated/v1.6-rig-helper-output.inp'],{stdio:'inherit',encoding:undefined});if(creator.status!==0)process.exit(creator.status??1);
console.log(JSON.stringify({ok:true,output:path.relative(root,outputPath),operationCount:operations.length,parameters:['Head X','Head Y'],previewStates:['-1,-1','1,1']}));
