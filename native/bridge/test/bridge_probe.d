import core.stdc.string : strlen;
import std.stdio : writeln;

extern(C) uint iat_bridge_abi_version();
extern(C) const(char)* iat_bridge_upstream_version();

int main() {
    assert(iat_bridge_abi_version() == 1);

    const(char)* rawVersion = iat_bridge_upstream_version();
    assert(rawVersion !is null);

    const(char)[] versionText = rawVersion[0 .. strlen(rawVersion)];
    assert(versionText == "v0.8.7");
    writeln(versionText);
    return 0;
}
