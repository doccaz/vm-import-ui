# Vendored OVF / CIM schemas

Used by `TestBuildOVF_ValidatesAgainstDSP8023` to validate generated OVF
descriptors offline (DSP0243 clause 493: "The OVF descriptor shall validate
against DSP8023").

## Provenance

| File | Version / Date | Source |
|------|----------------|--------|
| `dsp8023.xsd` | 1.1.0, 2009-12-22 | https://schemas.dmtf.org/ovf/envelope/1/dsp8023.xsd |
| `CIM_ResourceAllocationSettingData.xsd` | CIM schema 2.22.0 | https://schemas.dmtf.org/wbem/wscim/1/cim-schema/2.22.0/CIM_ResourceAllocationSettingData.xsd |
| `CIM_VirtualSystemSettingData.xsd` | CIM schema 2.22.0 | https://schemas.dmtf.org/wbem/wscim/1/cim-schema/2.22.0/CIM_VirtualSystemSettingData.xsd |
| `common.xsd` | — | https://schemas.dmtf.org/wbem/wscim/1/common.xsd |
| `xml.xsd` | — | https://www.w3.org/2001/xml.xsd |

Copyright (C) 2008, 2009 Distributed Management Task Force, Inc. (DMTF).
All rights reserved. The DMTF copyright notice permits members and non-members
to reproduce DMTF specifications and documents provided correct attribution is
given; the original notices are left intact inside each file.

## Local modification

**These files are not byte-identical to the DMTF originals.** One change was
made, to every file:

    schemaLocation="http(s)://.../Foo.xsd"  ->  schemaLocation="Foo.xsd"

Absolute `schemaLocation` URLs were rewritten to sibling filenames so `xmllint`
resolves imports from this directory instead of reaching out to the network.
No schema content — no type, element, attribute or ordering — was altered.

To refresh, re-download from the URLs above and re-apply that single rewrite.

## Why these are here but ovftool and VDDK are not

These DMTF schemas are freely redistributable with attribution, so they are
vendored. VMware's OVF Tool and the VMware VDDK are proprietary Broadcom
products that **may not be redistributed**: they are never vendored, never
downloaded by the build, and never baked into the container image. The tests
that use them (`TestOVA_ValidatesWithOvftool`, `TestVMDK_ReadableByVMwareVDDK`)
skip unless the tool is already present on the developer's own machine.
