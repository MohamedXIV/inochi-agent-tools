import std.conv : to;
import std.stdio : stderr, stdout;
import std.string : fromStringz, toStringz;

extern(C) int iat_inspect_puppet_json(const(char)* path, char** outJson, char** outError);
extern(C) int iat_evaluate_physics_json(const(char)* inputPath, const(char)* physicsPath, float delta, uint steps, float anchorDeltaX, char** outJson, char** outError);
extern(C) int iat_create_minimal_puppet_json(const(char)* outputPath, const(char)* name, char** outJson, char** outError);
extern(C) int iat_edit_visual_puppet_json(const(char)* inputPath, const(char)* outputPath, const(char)* operationsJson, char** outJson, char** outError);
extern(C) int iat_evaluate_parameters_json(const(char)* inputPath, const(char)* valuesJson, char** outJson, char** outError);
extern(C) int iat_capture_preview_frame_json(const(char)* inputPath, char** outJson, char** outError);
extern(C) int iat_render_preview_png_json(const(char)* inputPath, const(char)* outputPath, uint width, uint height, const(char)* valuesJson, char** outJson, char** outError);
extern(C) int iat_save_puppet(const(char)* inputPath, const(char)* outputPath, char** outError);
extern(C) void iat_string_free(char* value);

private int emitResult(int result, char* json, char* error, string fallback) {
    if (result != 0) { if (error !is null) { stderr.writeln(fromStringz(error)); iat_string_free(error); } else stderr.writeln(fallback); if (json !is null) iat_string_free(json); return result; }
    if (json is null) { if (error !is null) iat_string_free(error); stderr.writeln(fallback ~ " returned no JSON"); return 1; }
    stdout.write(fromStringz(json)); iat_string_free(json); if (error !is null) iat_string_free(error); return 0;
}
private int runInspect(string path) { char* json; char* error; auto result=iat_inspect_puppet_json(toStringz(path),&json,&error); if(result!=0){if(error !is null){stderr.writeln(fromStringz(error));iat_string_free(error);}else stderr.writeln("native puppet inspection failed");if(json !is null)iat_string_free(json);return 3;}return emitResult(0,json,error,"native puppet inspection"); }
private int runCreateMinimal(string outputPath,string name){char*j;char*e;return emitResult(iat_create_minimal_puppet_json(toStringz(outputPath),toStringz(name),&j,&e),j,e,"native minimal puppet creation failed");}
private int runEditVisual(string inputPath,string outputPath,string operationsJson){char*j;char*e;return emitResult(iat_edit_visual_puppet_json(toStringz(inputPath),toStringz(outputPath),toStringz(operationsJson),&j,&e),j,e,"native visual puppet authoring failed");}
private int runEvaluateParameters(string inputPath,string valuesJson){char*j;char*e;return emitResult(iat_evaluate_parameters_json(toStringz(inputPath),toStringz(valuesJson),&j,&e),j,e,"native parameter evaluation failed");}
private int runCapturePreviewFrame(string inputPath){char*j;char*e;return emitResult(iat_capture_preview_frame_json(toStringz(inputPath),&j,&e),j,e,"native preview frame capture failed");}
private int runRenderPreview(string inputPath,string outputPath,string width,string height,string valuesJson="") { char*j;char*e; try { auto values=valuesJson.length?toStringz(valuesJson):null; return emitResult(iat_render_preview_png_json(toStringz(inputPath),toStringz(outputPath),width.to!uint,height.to!uint,values,&j,&e),j,e,"native preview render failed"); } catch(Exception ex){stderr.writeln("invalid preview dimensions: ",ex.msg);return 2;} }
private int runEvaluatePhysics(string inputPath,string physicsPath,string delta,string steps,string anchorDeltaX){char*j;char*e;try{return emitResult(iat_evaluate_physics_json(toStringz(inputPath),toStringz(physicsPath),delta.to!float,steps.to!uint,anchorDeltaX.to!float,&j,&e),j,e,"native physics evaluation failed");}catch(Exception ex){stderr.writeln("invalid physics evaluation arguments: ",ex.msg);return 2;}}
private int runSaveAs(string inputPath,string outputPath){char*error;auto result=iat_save_puppet(toStringz(inputPath),toStringz(outputPath),&error);if(result!=0){if(error !is null){stderr.writeln(fromStringz(error));iat_string_free(error);}else stderr.writeln("native puppet save-as failed");return result;}if(error !is null)iat_string_free(error);return runInspect(outputPath);}

int main(string[] args){
    if(args.length==3&&args[1]=="inspect")return runInspect(args[2]);
    if(args.length==4&&args[1]=="create-minimal")return runCreateMinimal(args[2],args[3]);
    if(args.length==4&&args[1]=="save-as")return runSaveAs(args[2],args[3]);
    if(args.length==5&&args[1]=="edit-visual")return runEditVisual(args[2],args[3],args[4]);
    if(args.length==4&&args[1]=="evaluate-parameters")return runEvaluateParameters(args[2],args[3]);
    if(args.length==3&&args[1]=="capture-preview-frame")return runCapturePreviewFrame(args[2]);
    if(args.length==7&&args[1]=="evaluate-physics")return runEvaluatePhysics(args[2],args[3],args[4],args[5],args[6]);
    if(args.length==6&&args[1]=="render-preview")return runRenderPreview(args[2],args[3],args[4],args[5]);
    if(args.length==7&&args[1]=="render-preview")return runRenderPreview(args[2],args[3],args[4],args[5],args[6]);
    stderr.writeln("usage: iat_native_host inspect <puppet-path> | create-minimal <output.inp> <name> | save-as <input.inp> <output.inp> | edit-visual <input.inp> <output.inp> <operations-json> | evaluate-parameters <input.inp> <values-json> | capture-preview-frame <input.inp> | evaluate-physics <input.inp> <physics-path> <delta> <steps> <anchor-delta-x> | render-preview <input.inp> <output.png> <width> <height> [values-json]"); return 2;
}
