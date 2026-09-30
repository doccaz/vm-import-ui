// pkg/ovf.go
//
// OVF descriptor generation: KubeVirt VirtualMachine -> OVF envelope XML.
//
// Pure and I/O-free, so it can be exercised entirely offline against golden
// fixtures and validated against DSP8023 with xmllint.
//
// Two orderings in here are normative and must not be "tidied":
//
//   - Envelope children are an xs:sequence (DSP8023 EnvelopeType): References,
//     then Sections, then Content (VirtualSystem).
//   - CIM RASD and VSSD children are also xs:sequence, ordered alphabetically
//     (CIM_ResourceAllocationSettingData.xsd / CIM_VirtualSystemSettingData.xsd).
//     The struct field order below IS that order. Reordering fields produces XML
//     that no longer validates.
package main

import (
	"encoding/xml"
	"fmt"
	"strings"
)

// Profile selects the compatibility flavour of the generated descriptor.
type Profile string

const (
	// ProfileVMware targets vSphere/ESXi: OVF 1.1 with VMware extensions and
	// devices remapped to hardware ESXi actually implements.
	ProfileVMware Profile = "vmware"
	// ProfilePortable targets the widest range of consumers (VirtualBox,
	// Proxmox, oVirt): strict OVF 1.0, no vendor extensions.
	ProfilePortable Profile = "portable"
	// ProfileFaithful preserves the source virtio devices for a lossless
	// KVM/libvirt round-trip. Such a package will NOT boot on ESXi.
	ProfileFaithful Profile = "faithful"
)

// Disk format URIs. DSP0243 clause 451-456 requires the format to be named by a
// URI identifying an unencumbered specification.
const (
	diskFormatStreamOptimized = "http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"
	// The de-facto OVF identifier for qcow2, as used by oVirt/RHV and virt-v2v.
	diskFormatQcow2 = "http://www.gnome.org/~markmc/qcow-image-format.html"
)

// CIM_ResourceAllocationSettingData ResourceType values (DSP1041 / CIM schema).
const (
	rtProcessor      = 3
	rtMemory         = 4
	rtIDEController  = 5
	rtSCSIController = 6
	rtEthernet       = 10
	rtFloppy         = 14
	rtCDROM          = 15
	rtDiskDrive      = 17
	rtUSBController  = 23
)

// profileRules is the single source of truth for every per-profile difference.
// Keeping them in one struct is what lets the golden tests be meaningful, and it
// is why the qemu-img adapter type and the OVF ResourceSubType cannot drift
// apart (a mismatch makes ovftool warn).
type profileRules struct {
	ovfVersion        string // Envelope ovf:version; empty means omit (OVF 1.0)
	vmwExtensions     bool
	virtualSystemType string // empty means omit the element
	diskFormatURI     string
	diskExtension     string // ".vmdk" or ".qcow2"
	qemuFormat        string // qemu-img -O value
	qemuSubformat     string // qemu-img -o subformat=... ("" when not applicable)
	scsiSubType       string // RASD ResourceSubType for the disk controller
	qemuAdapterType   string // qemu-img -o adapter_type=... ; must match scsiSubType
	preserveVirtio    bool
	defaultNICSubType string
}

func rulesFor(p Profile) (profileRules, error) {
	switch p {
	case ProfileVMware:
		return profileRules{
			ovfVersion:        "1.1",
			vmwExtensions:     true,
			virtualSystemType: "vmx-15",
			diskFormatURI:     diskFormatStreamOptimized,
			diskExtension:     ".vmdk",
			qemuFormat:        "vmdk",
			qemuSubformat:     "streamOptimized",
			scsiSubType:       "lsilogic",
			qemuAdapterType:   "lsilogic",
			defaultNICSubType: "E1000E",
		}, nil
	case ProfilePortable:
		// OVF 1.0 has no ovf:version attribute on Envelope, so it is omitted.
		// E1000 (not E1000E) is the widest-supported emulated NIC.
		return profileRules{
			ovfVersion:        "",
			virtualSystemType: "",
			diskFormatURI:     diskFormatStreamOptimized,
			diskExtension:     ".vmdk",
			qemuFormat:        "vmdk",
			qemuSubformat:     "streamOptimized",
			scsiSubType:       "lsilogic",
			qemuAdapterType:   "lsilogic",
			defaultNICSubType: "E1000",
		}, nil
	case ProfileFaithful:
		// qemu-img's VMDK adapter_type accepts only ide|lsilogic|buslogic|
		// legacyESX - there is no virtio - so a "faithful" VMDK would have to
		// misdeclare its adapter. qcow2 keeps the round-trip honest instead.
		return profileRules{
			ovfVersion:        "1.1",
			virtualSystemType: "kvm",
			diskFormatURI:     diskFormatQcow2,
			diskExtension:     ".qcow2",
			qemuFormat:        "qcow2",
			scsiSubType:       "virtio",
			preserveVirtio:    true,
			defaultNICSubType: "virtio",
		}, nil
	default:
		return profileRules{}, fmt.Errorf("unknown OVF profile %q", p)
	}
}

// --- Inputs -----------------------------------------------------------------

// OVFDisk is one exported virtual disk.
type OVFDisk struct {
	Href          string // file name inside the OVA, e.g. "disk-0.vmdk"
	FileSize      int64  // size of the converted file on disk (ovf:size, populatedSize)
	CapacityBytes int64  // the source PVC's capacity (ovf:capacity)
	ChunkSize     int64  // 0 when the file is not chunked
	BusType       string // source bus: virtio, sata, scsi, ide
	BootOrder     int32
}

// OVFNetwork is one network interface.
type OVFNetwork struct {
	Name  string // KubeVirt interface/network name; becomes the OVF Network name
	Model string // virtio, e1000, e1000e
	MAC   string
}

// OVFInput is everything the descriptor needs, already extracted from KubeVirt.
type OVFInput struct {
	Name         string
	Namespace    string
	CPUs         int32
	MemoryMB     int32
	Firmware     string // bios or efi
	MachineType  string
	Architecture string
	GuestOSID    string // OperatingSystemSection ovf:id; "1" = Other
	GuestOSName  string
	FirmwareUUID string
	Disks        []OVFDisk
	Networks     []OVFNetwork
	CDROMs       int  // empty CD-ROM drives to declare
	PreserveMACs bool // emit rasd:Address for NICs
	Annotation   string
}

// --- Envelope structures ----------------------------------------------------

type ovfEnvelope struct {
	XMLName        xml.Name        `xml:"Envelope"`
	Attrs          []xml.Attr      `xml:",any,attr"`
	References     ovfReferences   `xml:"References"`
	DiskSection    *ovfDiskSection `xml:"DiskSection"`
	NetworkSection *ovfNetSection  `xml:"NetworkSection"`
	VirtualSystem  ovfVirtualSystem
}

type ovfReferences struct {
	Files []ovfFile `xml:"File"`
}

type ovfFile struct {
	ID        string `xml:"ovf:id,attr"`
	Href      string `xml:"ovf:href,attr"`
	Size      int64  `xml:"ovf:size,attr,omitempty"`
	ChunkSize int64  `xml:"ovf:chunkSize,attr,omitempty"`
}

type ovfDiskSection struct {
	XMLName xml.Name  `xml:"DiskSection"`
	Info    string    `xml:"Info"`
	Disks   []ovfDisk `xml:"Disk"`
}

type ovfDisk struct {
	DiskID                  string `xml:"ovf:diskId,attr"`
	FileRef                 string `xml:"ovf:fileRef,attr"`
	Capacity                string `xml:"ovf:capacity,attr"`
	CapacityAllocationUnits string `xml:"ovf:capacityAllocationUnits,attr"`
	Format                  string `xml:"ovf:format,attr"`
	PopulatedSize           int64  `xml:"ovf:populatedSize,attr,omitempty"`
}

type ovfNetSection struct {
	XMLName  xml.Name     `xml:"NetworkSection"`
	Info     string       `xml:"Info"`
	Networks []ovfNetwork `xml:"Network"`
}

type ovfNetwork struct {
	Name        string `xml:"ovf:name,attr"`
	Description string `xml:"Description"`
}

type ovfVirtualSystem struct {
	XMLName    xml.Name `xml:"VirtualSystem"`
	ID         string   `xml:"ovf:id,attr"`
	Info       string   `xml:"Info"`
	Name       string   `xml:"Name"`
	OSSection  ovfOSSection
	Hardware   ovfHardwareSection
	Annotation *ovfAnnotationSection
}

type ovfOSSection struct {
	XMLName xml.Name `xml:"OperatingSystemSection"`
	ID      string   `xml:"ovf:id,attr"`
	OSType  string   `xml:"vmw:osType,attr,omitempty"`
	Info    string   `xml:"Info"`
	Desc    string   `xml:"Description"`
}

type ovfAnnotationSection struct {
	XMLName    xml.Name `xml:"AnnotationSection"`
	Info       string   `xml:"Info"`
	Annotation string   `xml:"Annotation"`
}

type ovfHardwareSection struct {
	XMLName xml.Name  `xml:"VirtualHardwareSection"`
	Info    string    `xml:"Info"`
	System  ovfSystem `xml:"System"`
	Items   []ovfItem `xml:"Item"`
	Configs []ovfVMWConfig
}

// ovfSystem holds CIM_VirtualSystemSettingData. Field order follows that
// schema's xs:sequence (alphabetical): ElementName, InstanceID,
// VirtualSystemIdentifier, VirtualSystemType.
type ovfSystem struct {
	ElementName             string `xml:"vssd:ElementName"`
	InstanceID              string `xml:"vssd:InstanceID"`
	VirtualSystemIdentifier string `xml:"vssd:VirtualSystemIdentifier"`
	VirtualSystemType       string `xml:"vssd:VirtualSystemType,omitempty"`
}

// ovfItem holds CIM_ResourceAllocationSettingData. FIELD ORDER IS NORMATIVE:
// the CIM schema declares these as an xs:sequence in alphabetical order.
type ovfItem struct {
	XMLName             xml.Name `xml:"Item"`
	Address             string   `xml:"rasd:Address,omitempty"`
	AddressOnParent     string   `xml:"rasd:AddressOnParent,omitempty"`
	AllocationUnits     string   `xml:"rasd:AllocationUnits,omitempty"`
	AutomaticAllocation string   `xml:"rasd:AutomaticAllocation,omitempty"`
	Caption             string   `xml:"rasd:Caption,omitempty"`
	Connection          string   `xml:"rasd:Connection,omitempty"`
	Description         string   `xml:"rasd:Description,omitempty"`
	ElementName         string   `xml:"rasd:ElementName"`
	HostResource        string   `xml:"rasd:HostResource,omitempty"`
	InstanceID          string   `xml:"rasd:InstanceID"`
	Parent              string   `xml:"rasd:Parent,omitempty"`
	ResourceSubType     string   `xml:"rasd:ResourceSubType,omitempty"`
	ResourceType        int      `xml:"rasd:ResourceType"`
	VirtualQuantity     int64    `xml:"rasd:VirtualQuantity,omitempty"`
}

type ovfVMWConfig struct {
	XMLName  xml.Name `xml:"vmw:Config"`
	Required string   `xml:"ovf:required,attr"`
	Key      string   `xml:"vmw:key,attr"`
	Value    string   `xml:"vmw:value,attr"`
}

// --- Generation -------------------------------------------------------------

// capacityMiB converts bytes to whole MiB, always rounding UP.
//
// ovf:capacityAllocationUnits="byte * 2^20" means MiB, not bytes: passing a raw
// byte count inflates the declared disk by ~10^6. Rounding down is equally
// wrong in the other direction - the guest filesystem would be larger than the
// disk it claims to sit on, and vCenter rejects the package.
func capacityMiB(bytes int64) int64 {
	const mib = int64(1) << 20
	if bytes <= 0 {
		return 0
	}
	return (bytes + mib - 1) / mib
}

// BuildOVF renders the OVF descriptor for one VM under the given profile.
func BuildOVF(in OVFInput, p Profile) ([]byte, error) {
	rules, err := rulesFor(p)
	if err != nil {
		return nil, err
	}
	if in.Name == "" {
		return nil, fmt.Errorf("VM name is required")
	}
	if len(in.Disks) == 0 {
		return nil, fmt.Errorf("VM %q has no disks to export", in.Name)
	}
	// A disk of unknown capacity would emit ovf:capacity="0": a well-formed
	// package that silently declares a zero-byte disk. pvcIndex is best-effort,
	// so a transient PVC-list failure could otherwise produce a garbage OVA that
	// passes every validator. Fail loudly instead.
	for i, d := range in.Disks {
		if d.CapacityBytes <= 0 {
			return nil, fmt.Errorf("disk %d (%s) has unknown capacity; refusing to emit a descriptor claiming a zero-byte disk", i, d.Href)
		}
	}

	env := ovfEnvelope{Attrs: envelopeAttrs(rules)}

	// References + DiskSection, in lockstep so fileRef/diskId always agree.
	disks := &ovfDiskSection{Info: "Virtual disk information"}
	for i, d := range in.Disks {
		fileID := fmt.Sprintf("file%d", i+1)
		env.References.Files = append(env.References.Files, ovfFile{
			ID:        fileID,
			Href:      d.Href,
			Size:      d.FileSize,
			ChunkSize: d.ChunkSize,
		})
		disks.Disks = append(disks.Disks, ovfDisk{
			DiskID:                  fmt.Sprintf("vmdisk%d", i+1),
			FileRef:                 fileID,
			Capacity:                fmt.Sprintf("%d", capacityMiB(d.CapacityBytes)),
			CapacityAllocationUnits: "byte * 2^20",
			Format:                  rules.diskFormatURI,
			PopulatedSize:           d.FileSize,
		})
	}
	env.DiskSection = disks

	if len(in.Networks) > 0 {
		ns := &ovfNetSection{Info: "The list of logical networks"}
		for _, n := range in.Networks {
			ns.Networks = append(ns.Networks, ovfNetwork{
				Name:        n.Name,
				Description: fmt.Sprintf("The %s network", n.Name),
			})
		}
		env.NetworkSection = ns
	}

	env.VirtualSystem = ovfVirtualSystem{
		ID:   in.Name,
		Info: "A virtual machine",
		Name: in.Name,
		OSSection: ovfOSSection{
			ID:   defaultString(in.GuestOSID, "1"),
			Info: "The kind of installed guest operating system",
			Desc: defaultString(in.GuestOSName, "Other"),
		},
		Hardware: buildHardware(in, rules),
	}
	if in.Annotation != "" {
		env.VirtualSystem.Annotation = &ovfAnnotationSection{
			Info:       "A human-readable annotation",
			Annotation: in.Annotation,
		}
	}

	body, err := xml.MarshalIndent(env, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshalling OVF: %w", err)
	}
	return append([]byte(xml.Header), append(body, '\n')...), nil
}

func envelopeAttrs(r profileRules) []xml.Attr {
	attrs := []xml.Attr{
		{Name: xml.Name{Local: "xmlns"}, Value: "http://schemas.dmtf.org/ovf/envelope/1"},
		{Name: xml.Name{Local: "xmlns:ovf"}, Value: "http://schemas.dmtf.org/ovf/envelope/1"},
		{Name: xml.Name{Local: "xmlns:rasd"}, Value: "http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"},
		{Name: xml.Name{Local: "xmlns:vssd"}, Value: "http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"},
		{Name: xml.Name{Local: "xmlns:xsi"}, Value: "http://www.w3.org/2001/XMLSchema-instance"},
	}
	if r.vmwExtensions {
		attrs = append(attrs, xml.Attr{Name: xml.Name{Local: "xmlns:vmw"}, Value: "http://www.vmware.com/schema/ovf"})
	}
	if r.ovfVersion != "" {
		attrs = append(attrs, xml.Attr{Name: xml.Name{Local: "ovf:version"}, Value: r.ovfVersion})
	}
	return attrs
}

func buildHardware(in OVFInput, r profileRules) ovfHardwareSection {
	hw := ovfHardwareSection{
		Info: "Virtual hardware requirements",
		System: ovfSystem{
			ElementName:             "Virtual Hardware Family",
			InstanceID:              "0",
			VirtualSystemIdentifier: in.Name,
			VirtualSystemType:       r.virtualSystemType,
		},
	}

	instance := 0
	next := func() string { instance++; return fmt.Sprintf("%d", instance) }

	hw.Items = append(hw.Items, ovfItem{
		AllocationUnits: "hertz * 10^6",
		Description:     "Number of Virtual CPUs",
		ElementName:     fmt.Sprintf("%d virtual CPU(s)", in.CPUs),
		InstanceID:      next(),
		ResourceType:    rtProcessor,
		VirtualQuantity: int64(in.CPUs),
	})
	hw.Items = append(hw.Items, ovfItem{
		AllocationUnits: "byte * 2^20",
		Description:     "Memory Size",
		ElementName:     fmt.Sprintf("%dMB of memory", in.MemoryMB),
		InstanceID:      next(),
		ResourceType:    rtMemory,
		VirtualQuantity: int64(in.MemoryMB),
	})

	// One disk controller carries every exported disk. Each profile picks a
	// controller its target actually implements; the faithful profile keeps
	// virtio, which is why its packages do not boot on ESXi.
	controllerID := next()
	hw.Items = append(hw.Items, ovfItem{
		Address:         "0",
		Description:     "SCSI Controller",
		ElementName:     "SCSI Controller 0",
		InstanceID:      controllerID,
		ResourceSubType: r.scsiSubType,
		ResourceType:    rtSCSIController,
	})

	for i, d := range in.Disks {
		hw.Items = append(hw.Items, ovfItem{
			AddressOnParent: fmt.Sprintf("%d", i),
			ElementName:     fmt.Sprintf("Hard Disk %d", i+1),
			HostResource:    fmt.Sprintf("ovf:/disk/vmdisk%d", i+1),
			InstanceID:      next(),
			Parent:          controllerID,
			ResourceType:    rtDiskDrive,
		})
		_ = d
	}

	for i, n := range in.Networks {
		item := ovfItem{
			AddressOnParent:     fmt.Sprintf("%d", i+1),
			AutomaticAllocation: "true",
			Connection:          n.Name,
			Description:         "Network adapter",
			ElementName:         fmt.Sprintf("Network adapter %d", i+1),
			InstanceID:          next(),
			ResourceSubType:     nicSubType(n.Model, r),
			ResourceType:        rtEthernet,
		}
		if in.PreserveMACs && n.MAC != "" {
			item.Address = n.MAC
		}
		hw.Items = append(hw.Items, item)
	}

	// CD-ROMs are declared as empty drives: the backing ISO is never exported.
	// They get their own IDE controller rather than hanging off the SCSI one -
	// sharing it would collide with the disks' AddressOnParent numbering, and an
	// IDE-attached optical drive is what mainstream producers emit.
	if in.CDROMs > 0 {
		ideID := next()
		hw.Items = append(hw.Items, ovfItem{
			Address:      "1",
			Description:  "IDE Controller",
			ElementName:  "IDE Controller 0",
			InstanceID:   ideID,
			ResourceType: rtIDEController,
		})
		for i := 0; i < in.CDROMs; i++ {
			hw.Items = append(hw.Items, ovfItem{
				AddressOnParent:     fmt.Sprintf("%d", i),
				AutomaticAllocation: "false",
				ElementName:         fmt.Sprintf("CD-ROM %d", i+1),
				InstanceID:          next(),
				Parent:              ideID,
				ResourceType:        rtCDROM,
			})
		}
	}

	if r.vmwExtensions {
		if in.FirmwareUUID != "" {
			hw.Configs = append(hw.Configs, ovfVMWConfig{Required: "false", Key: "uuid.bios", Value: in.FirmwareUUID})
		}
		if in.Firmware != "" {
			hw.Configs = append(hw.Configs, ovfVMWConfig{Required: "false", Key: "firmware", Value: strings.ToLower(in.Firmware)})
		}
	}
	return hw
}

// nicSubType maps a KubeVirt NIC model onto the profile's emulated adapter.
// The faithful profile passes the source model through unchanged.
func nicSubType(model string, r profileRules) string {
	if r.preserveVirtio {
		return defaultString(model, "virtio")
	}
	switch strings.ToLower(model) {
	case "e1000":
		return "E1000"
	case "e1000e":
		return "E1000E"
	case "rtl8139":
		return "PCNet32"
	default:
		// virtio and anything unrecognised become the profile's default, since
		// no VMware-family target implements virtio.
		return r.defaultNICSubType
	}
}

func defaultString(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
