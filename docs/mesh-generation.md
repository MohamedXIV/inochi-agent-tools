# v2 automatic mesh generation

Issue #43 converts a normalized Rig Project plus real layered PNG assets into deterministic ordinary `MeshTopology` values. It is a semantic planning stage in core, not a second native rigging engine.

`fitRigProjectMeshes()` reads each layer source and optional mask, derives alpha content bounds, preserves authored pivot/anchor cuts, creates a bounded row-major grid, and fingerprints the resulting plan. The generated mesh is applied through the existing `part.setMesh` primitive using `partSetMeshOperation()`.

Defaults are deliberately bounded: alpha threshold 1, one pixel of padding, 48-pixel target cells, and at most 16 cuts per axis. Callers may tune those values, but impossible hint density, empty alpha, source/mask dimension mismatch, unsupported PNG encoding, and degenerate topology fail closed through `InvalidMeshGenerationError` with machine-readable diagnostics.

PNG decoding is intentionally narrow and deterministic: non-interlaced 8-bit grayscale, RGB, grayscale-alpha, and RGBA inputs. There is no segmentation model, content inference, hidden native optimizer, or product-specific body/wardrobe policy.

The native acceptance lane uses real transparent layered PNGs, writes the generated meshes into a real `.inp`, reopens it, renders a non-empty headless PNG preview, and opens the artifact through the accepted Creator compatibility path.
