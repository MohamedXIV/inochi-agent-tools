import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root=process.cwd();
const outDir=path.join(root,'.build','native');
const hostPath=path.join(outDir,process.platform==='win32'?'iat_native_host.exe':'iat_native_host');
const inputPath=path.join(root,'tests','fixtures','generated','core-v1.3-opacity-output.inp');
const outputPath=path.join(root,'tests','fixtures','generated','v1.5-physics-output.inp');
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';
const env={...process.env,LD_LIBRARY_PATH:[outDir,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),DYLD_LIBRARY_PATH:[outDir,process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),PATH:[outDir,process.env.PATH].filter(Boolean).join(path.delimiter)};
function run(command,args,options={}){const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',...options});if(r.error)throw r.error;return r;}
function jsonSuccess(r,label){if(r.status!==0){console.error(r.stderr||`${label} exited ${r.status}`);process.exit(r.status??1);}try{return JSON.parse(r.stdout);}catch(e){console.error(`${label} emitted invalid JSON: ${e}`);process.exit(1);}}
const prior=run(npmCommand,['run','v1.3:visual-controls:ci'],{stdio:'inherit',encoding:undefined}); if(prior.status!==0)process.exit(prior.status??1);
const hostBuild=run('dub',['build','--root=native/host','--compiler=ldc2','--build=debug'],{stdio:'inherit',encoding:undefined}); if(hostBuild.status!==0)process.exit(hostBuild.status??1);
rmSync(outputPath,{force:true});
const operations=[{type:'physics.create',parentPath:'/Root',name:'HairPhysics',parameterName:'Visibility',model:'pendulum',mapMode:'angle_length',gravity:1,length:100,frequency:1,angleDamping:0.5,lengthDamping:0.5,outputScale:[1,1],localOnly:true}];
const authored=jsonSuccess(run(hostPath,['edit-visual',inputPath,outputPath,JSON.stringify(operations)]),'physics authoring');
const node=authored.nodes?.find(n=>n.path==='/Root/HairPhysics');
if(!node||node.kind!=='simple-physics'||node.physics?.parameterName!=='Visibility'||node.physics?.model!=='pendulum'||node.physics?.mapMode!=='angle-length'){console.error('authored physics inspection mismatch');process.exit(1);}
const reopened=jsonSuccess(run(hostPath,['inspect',outputPath]),'physics reopen inspection');
const reopenedNode=reopened.nodes?.find(n=>n.path==='/Root/HairPhysics');
if(!reopenedNode||JSON.stringify(reopenedNode.physics)!==JSON.stringify(node.physics)){console.error('physics settings did not survive save/reopen');process.exit(1);}
const evaluation=jsonSuccess(run(hostPath,['evaluate-physics',outputPath,'/Root/HairPhysics','0.016','12','40']),'physics runtime evaluation');
if(evaluation.kind!=='inochi2d-simple-physics-evaluation'||evaluation.parameterName!=='Visibility'||evaluation.consumed!==true){console.error('runtime did not consume authored physics');process.exit(1);}
run(npmCommand,['run','creator:materialize'],{stdio:'inherit',encoding:undefined});
const creator=run(process.execPath,['scripts/creator/launch-roundtrip.mjs','--open-only','tests/fixtures/generated/v1.5-physics-output.inp'],{stdio:'inherit',encoding:undefined}); if(creator.status!==0)process.exit(creator.status??1);
console.log(JSON.stringify({ok:true,output:path.relative(root,outputPath),physics:reopenedNode.physics,runtime:{before:evaluation.before,after:evaluation.after,consumed:evaluation.consumed}}));
