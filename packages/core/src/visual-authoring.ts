import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type { NativeHostOptions } from './authoring.js';
import {
  InvalidAuthoringRequestError,
  InvalidBindingError,
  InvalidHierarchyError,
  InvalidTextureAssetError,
  MissingTextureError,
  NativeBridgeError,
  PuppetAlreadyExistsError,
  RoundTripMismatchError,
} from './errors.js';
import {
  parsePuppetInspection,
  type NumericPair,
  type ParameterBindingProperty,
  type PuppetInspection,
} from './inspection.js';

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export interface MeshTopology {
  vertices: NumericPair[];
  uvs: NumericPair[];
  indices: number[];
}

export interface DeformerCreateOperation { type: 'deformer.create'; kind: 'mesh'; parentPath: string; name: string; mesh: MeshTopology; }
export interface DeformerSetMeshOperation { type: 'deformer.setMesh'; path: string; mesh: MeshTopology; }
export interface ParameterCreateOperation { type: 'parameter.create'; name: string; dimensions: 1 | 2; min: NumericPair; max: NumericPair; defaultValue: NumericPair; }
export interface ParameterBindOperation { type: 'parameter.bind'; parameterName: string; targetPath: string; property: ParameterBindingProperty; keypoints: Array<{ at: NumericPair; value: number }>; }
export interface ParameterUnbindOperation { type: 'parameter.unbind'; parameterName: string; targetPath: string; property: ParameterBindingProperty; }

export type PuppetEditOperation =
  | { type: 'texture.import'; key: string; imagePath: string }
  | { type: 'node.create'; parentPath: string; name: string }
  | { type: 'part.create'; parentPath: string; name: string; textureKey: string }
  | { type: 'part.setTexture'; path: string; textureKey: string }
  | { type: 'part.setMesh'; path: string; mesh: MeshTopology }
  | DeformerCreateOperation
  | DeformerSetMeshOperation
  | { type: 'node.reparent'; path: string; newParentPath: string }
  | { type: 'node.remove'; path: string }
  | ParameterCreateOperation | ParameterBindOperation | ParameterUnbindOperation;
export type VisualEditOperation = PuppetEditOperation;
export interface EditPuppetRequest { inputPath: string; outputPath: string; operations: PuppetEditOperation[]; }
export interface EditPuppetResult { path: string; inspection: PuppetInspection; }
interface ExecFailure extends Error { code?: string | number; stderr?: string; }

const BINDING_PROPERTIES = new Set<ParameterBindingProperty>(['zSort','transform.t.x','transform.t.y','transform.t.z','transform.r.x','transform.r.y','transform.r.z','transform.s.x','transform.s.y']);
function defaultNativeHostPath(): string { const executable = process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host'; return path.resolve(process.cwd(), '.build', 'native', executable); }
function nativeHostEnv(): NodeJS.ProcessEnv { const outDir = path.resolve(process.cwd(), '.build', 'native'); return { ...process.env, LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'), DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'), PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter) }; }
function failureDiagnostic(failure: ExecFailure): string { return failure.stderr?.trim() || failure.message || 'native puppet authoring failed'; }
function requireSemanticText(value: string, label: string): void { if (!value.trim()) throw new InvalidAuthoringRequestError(`${label} must not be blank`); if (value.includes('\0')) throw new InvalidAuthoringRequestError(`${label} must not contain NUL`); }
function requireBindingText(value: string, label: string): void { if (!value.trim()) throw new InvalidBindingError(`${label} must not be blank`); if (value.includes('\0')) throw new InvalidBindingError(`${label} must not contain NUL`); }
function isFinitePair(value: unknown): value is NumericPair { return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite); }
function requireFinitePair(value: NumericPair, label: string): void { if (!isFinitePair(value)) throw new InvalidBindingError(`${label} must be a finite numeric pair`); }
function validateMesh(mesh: MeshTopology): void {
  if (!mesh || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.uvs) || !Array.isArray(mesh.indices)) throw new InvalidAuthoringRequestError('Mesh must contain vertices, uvs, and indices arrays');
  if (mesh.vertices.length < 3 || mesh.vertices.length !== mesh.uvs.length) throw new InvalidAuthoringRequestError('Mesh vertices and UVs must have equal cardinality with at least three vertices');
  if (!mesh.vertices.every(isFinitePair) || !mesh.uvs.every(isFinitePair)) throw new InvalidAuthoringRequestError('Mesh vertices and UVs must be finite numeric pairs');
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) throw new InvalidAuthoringRequestError('Mesh indices must describe triangles');
  if (mesh.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length)) throw new InvalidAuthoringRequestError('Mesh index is outside the vertex range');
}
function validateParameterCreate(operation: ParameterCreateOperation): void { requireBindingText(operation.name,'Parameter name'); if(operation.dimensions!==1&&operation.dimensions!==2) throw new InvalidBindingError('Parameter dimensions must be 1 or 2'); requireFinitePair(operation.min,'Parameter minimum'); requireFinitePair(operation.max,'Parameter maximum'); requireFinitePair(operation.defaultValue,'Parameter default'); if(operation.min[0]>=operation.max[0]) throw new InvalidBindingError('Parameter X minimum must be less than maximum'); if(operation.defaultValue[0]<operation.min[0]||operation.defaultValue[0]>operation.max[0]) throw new InvalidBindingError('Parameter X default must be inside its range'); if(operation.dimensions===1){if(operation.min[1]!==0||operation.max[1]!==0||operation.defaultValue[1]!==0) throw new InvalidBindingError('1D parameter Y range/default must be zero'); return;} if(operation.min[1]>=operation.max[1]) throw new InvalidBindingError('Parameter Y minimum must be less than maximum'); if(operation.defaultValue[1]<operation.min[1]||operation.defaultValue[1]>operation.max[1]) throw new InvalidBindingError('Parameter Y default must be inside its range'); }
function validateBindingProperty(property: ParameterBindingProperty): void { if(!BINDING_PROPERTIES.has(property)) throw new InvalidBindingError(`Unsupported binding property: ${String(property)}`); }
function validateParameterBind(operation: ParameterBindOperation): void { requireBindingText(operation.parameterName,'Parameter name'); requireBindingText(operation.targetPath,'Binding target path'); validateBindingProperty(operation.property); if(!Array.isArray(operation.keypoints)||operation.keypoints.length===0) throw new InvalidBindingError('Parameter binding requires at least one keypoint'); for(const [index,keypoint] of operation.keypoints.entries()){requireFinitePair(keypoint.at,`Binding keypoint ${index} parameter value`); if(!Number.isFinite(keypoint.value)) throw new InvalidBindingError(`Binding keypoint ${index} value must be finite`);} }
function validateParameterUnbind(operation: ParameterUnbindOperation): void { requireBindingText(operation.parameterName,'Parameter name'); requireBindingText(operation.targetPath,'Binding target path'); validateBindingProperty(operation.property); }
function validateOperation(operation: PuppetEditOperation): void {
  switch(operation.type){
    case 'texture.import': requireSemanticText(operation.key,'Texture key'); requireSemanticText(operation.imagePath,'Texture image path'); return;
    case 'node.create': requireSemanticText(operation.parentPath,'Parent path'); requireSemanticText(operation.name,'Node name'); return;
    case 'part.create': requireSemanticText(operation.parentPath,'Parent path'); requireSemanticText(operation.name,'Part name'); requireSemanticText(operation.textureKey,'Texture key'); return;
    case 'part.setTexture': requireSemanticText(operation.path,'Part path'); requireSemanticText(operation.textureKey,'Texture key'); return;
    case 'part.setMesh': requireSemanticText(operation.path,'Part path'); validateMesh(operation.mesh); return;
    case 'deformer.create': if(operation.kind!=='mesh') throw new InvalidAuthoringRequestError(`Unsupported deformer kind: ${String(operation.kind)}`); requireSemanticText(operation.parentPath,'Deformer parent path'); requireSemanticText(operation.name,'Deformer name'); validateMesh(operation.mesh); return;
    case 'deformer.setMesh': requireSemanticText(operation.path,'Deformer path'); validateMesh(operation.mesh); return;
    case 'node.reparent': requireSemanticText(operation.path,'Node path'); requireSemanticText(operation.newParentPath,'New parent path'); return;
    case 'node.remove': requireSemanticText(operation.path,'Node path'); return;
    case 'parameter.create': validateParameterCreate(operation); return;
    case 'parameter.bind': validateParameterBind(operation); return;
    case 'parameter.unbind': validateParameterUnbind(operation); return;
  }
}
function validateEditPuppetRequest(request: EditPuppetRequest): void { if(path.extname(request.inputPath).toLowerCase()!=='.inp'||path.extname(request.outputPath).toLowerCase()!=='.inp') throw new InvalidAuthoringRequestError('Puppet authoring input and output paths must end in .inp'); requireSemanticText(request.inputPath,'Input path'); requireSemanticText(request.outputPath,'Output path'); const input=path.resolve(process.cwd(),request.inputPath); const output=path.resolve(process.cwd(),request.outputPath); if(input===output) throw new InvalidAuthoringRequestError('Puppet authoring requires distinct input and output paths'); if(request.operations.length===0) throw new InvalidAuthoringRequestError('Puppet authoring requires at least one operation'); const createdParameterNames=new Set<string>(); for(const operation of request.operations){validateOperation(operation); if(operation.type==='parameter.create'){if(createdParameterNames.has(operation.name)) throw new InvalidBindingError(`Duplicate parameter name in transaction: ${operation.name}`); createdParameterNames.add(operation.name);}} }
export async function editPuppet(request: EditPuppetRequest, options: NativeHostOptions = {}): Promise<EditPuppetResult> {
  validateEditPuppetRequest(request); const inputPath=path.resolve(process.cwd(),request.inputPath); const outputPath=path.resolve(process.cwd(),request.outputPath); const hostPath=options.hostPath??defaultNativeHostPath();
  try { const {stdout}=await execFileAsync(hostPath,['edit-visual',inputPath,outputPath,JSON.stringify(request.operations)],{cwd:process.cwd(),env:nativeHostEnv(),encoding:'utf8',maxBuffer:MAX_CAPTURE_BYTES,windowsHide:true}); let decoded:unknown; try{decoded=JSON.parse(stdout);}catch(error){throw new NativeBridgeError(`Native host emitted invalid authoring JSON: ${error instanceof Error?error.message:String(error)}`);} let inspection:PuppetInspection; try{inspection=parsePuppetInspection(decoded);}catch(error){throw new NativeBridgeError(`Native host emitted an invalid authoring snapshot: ${error instanceof Error?error.message:String(error)}`);} return {path:outputPath,inspection};
  } catch(error) { if(error instanceof InvalidAuthoringRequestError||error instanceof InvalidBindingError||error instanceof InvalidHierarchyError||error instanceof MissingTextureError||error instanceof InvalidTextureAssetError||error instanceof PuppetAlreadyExistsError||error instanceof RoundTripMismatchError||error instanceof NativeBridgeError) throw error; const failure=error as ExecFailure; const diagnostic=failureDiagnostic(failure); if(failure.code===5) throw new PuppetAlreadyExistsError(diagnostic); if(failure.code===6) throw new RoundTripMismatchError(diagnostic); if(failure.code===7) throw new InvalidHierarchyError(diagnostic); if(failure.code===8) throw new MissingTextureError(diagnostic); if(failure.code===9) throw new InvalidTextureAssetError(diagnostic); if(failure.code===10) throw new InvalidBindingError(diagnostic); throw new NativeBridgeError(diagnostic); }
}
