// pkg/export_worker.go
//
// The export worker: the half of the export that runs inside a Kubernetes Job,
// invoked as `vm-import-ui export-worker`.
//
// It deliberately has NO Kubernetes access. Everything it needs arrives through
// the EXPORT_SPEC environment variable and the volumes mounted into the Job, so
// the Job runs with automountServiceAccountToken: false. That keeps a process
// which handles raw disk images away from the API server entirely.
//
// Pipeline, per DSP0243 (see ova.go / ovf.go):
//
//	block device -> qemu-img convert -> staged disk -> descriptor -> OVA tar
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
)

// ExportSpec is the complete instruction set handed to the worker.
type ExportSpec struct {
	ExportID    string           `json:"exportId"`
	VMNamespace string           `json:"vmNamespace"`
	VMName      string           `json:"vmName"`
	TargetName  string           `json:"targetName"` // OVA basename, without extension
	Profile     string           `json:"profile"`
	Disks       []ExportDiskSpec `json:"disks"`
	OVF         OVFInput         `json:"ovf"` // everything except disk hrefs/sizes
}

// ExportDiskSpec is one source disk, presented to the Job as a raw block device.
type ExportDiskSpec struct {
	DevicePath    string `json:"devicePath"` // e.g. /dev/vmdisk0
	CapacityBytes int64  `json:"capacityBytes"`
	BusType       string `json:"busType"`
	BootOrder     int32  `json:"bootOrder"`
}

// ExportStatus is written to <root>/.vm-import-ui/<exportID>/status.json and is
// the API pod's view of progress. The worker has no cluster access, so this file
// (plus the Job's own status) is the entire status channel.
type ExportStatus struct {
	ExportID    string     `json:"exportId"`
	VMNamespace string     `json:"vmNamespace"`
	VMName      string     `json:"vmName"`
	Profile     string     `json:"profile"`
	Phase       string     `json:"phase"`
	Stage       string     `json:"stage"`
	Percent     int        `json:"percent"`
	BytesTotal  int64      `json:"bytesTotal"`
	BytesDone   int64      `json:"bytesDone"`
	OvaPath     string     `json:"ovaPath,omitempty"`
	SizeBytes   int64      `json:"sizeBytes,omitempty"`
	TarFormat   string     `json:"tarFormat,omitempty"`
	Chunked     bool       `json:"chunked,omitempty"`
	Message     string     `json:"message,omitempty"`
	Error       string     `json:"error,omitempty"`
	StartedAt   time.Time  `json:"startedAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
}

// Export phases.
const (
	PhasePending    = "Pending"
	PhaseConverting = "Converting"
	PhaseAssembling = "Assembling"
	PhaseReady      = "Ready"
	PhaseFailed     = "Failed"
)

// statusWriter persists ExportStatus atomically so a reader never sees a
// half-written file.
type statusWriter struct {
	path   string
	status ExportStatus
}

func newStatusWriter(root, exportID string, s ExportStatus) (*statusWriter, error) {
	dir := filepath.Join(root, ".vm-import-ui", exportID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating status directory: %w", err)
	}
	w := &statusWriter{path: filepath.Join(dir, "status.json"), status: s}
	return w, w.flush()
}

func (w *statusWriter) flush() error {
	w.status.UpdatedAt = time.Now().UTC()
	b, err := json.MarshalIndent(w.status, "", "  ")
	if err != nil {
		return err
	}
	tmp := w.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, w.path)
}

func (w *statusWriter) set(mutate func(*ExportStatus)) {
	mutate(&w.status)
	if err := w.flush(); err != nil {
		// Status is best-effort: losing an update must not abort the export.
		log.Warnf("Could not write status file: %v", err)
	}
}

func (w *statusWriter) fail(err error) {
	now := time.Now().UTC()
	w.set(func(s *ExportStatus) {
		s.Phase = PhaseFailed
		s.Error = err.Error()
		s.FinishedAt = &now
	})
}

// RunExportWorker is the `export-worker` entry point. It returns an exit code.
func RunExportWorker() int {
	root := envOr("EXPORT_ROOT", "/export")
	raw := os.Getenv("EXPORT_SPEC")
	if raw == "" {
		log.Error("EXPORT_SPEC is empty; nothing to do")
		return 2
	}
	var spec ExportSpec
	if err := json.Unmarshal([]byte(raw), &spec); err != nil {
		log.Errorf("EXPORT_SPEC is not valid JSON: %v", err)
		return 2
	}

	var total int64
	for _, d := range spec.Disks {
		total += d.CapacityBytes
	}
	sw, err := newStatusWriter(root, spec.ExportID, ExportStatus{
		ExportID:    spec.ExportID,
		VMNamespace: spec.VMNamespace,
		VMName:      spec.VMName,
		Profile:     spec.Profile,
		Phase:       PhasePending,
		BytesTotal:  total,
		StartedAt:   time.Now().UTC(),
	})
	if err != nil {
		log.Errorf("Cannot write to the export volume at %s: %v", root, err)
		return 1
	}

	if err := runExport(root, spec, sw); err != nil {
		log.Errorf("Export failed: %v", err)
		sw.fail(err)
		return 1
	}
	return 0
}

func runExport(root string, spec ExportSpec, sw *statusWriter) error {
	rules, err := rulesFor(Profile(spec.Profile))
	if err != nil {
		return err
	}
	if len(spec.Disks) == 0 {
		return fmt.Errorf("no disks to export")
	}

	// Stage converted disks alongside the final OVA. Both live on the export
	// volume, so peak usage is roughly (sum of converted disks) + (OVA size);
	// the caller pre-flights free space against that.
	staging := filepath.Join(root, ".vm-import-ui", spec.ExportID, "staging")
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return fmt.Errorf("creating staging directory: %w", err)
	}
	defer func() {
		if err := os.RemoveAll(staging); err != nil {
			log.Warnf("Could not remove staging directory %s: %v", staging, err)
		}
	}()

	ovfIn := spec.OVF
	ovfIn.Disks = nil
	files := make([]OvaFile, 0, len(spec.Disks))

	var doneBytes int64
	for i, d := range spec.Disks {
		href := fmt.Sprintf("disk-%d%s", i, rules.diskExtension)
		out := filepath.Join(staging, href)

		sw.set(func(s *ExportStatus) {
			s.Phase = PhaseConverting
			s.Stage = fmt.Sprintf("converting disk %d of %d", i+1, len(spec.Disks))
		})
		log.Infof("Converting %s -> %s", d.DevicePath, out)

		base := doneBytes
		onPercent := func(p float64) {
			sw.set(func(s *ExportStatus) {
				s.BytesDone = base + int64(float64(d.CapacityBytes)*p/100.0)
				if s.BytesTotal > 0 {
					s.Percent = int(float64(s.BytesDone) * 100.0 / float64(s.BytesTotal))
				}
			})
		}
		if err := convertDisk(d.DevicePath, out, rules, onPercent); err != nil {
			return fmt.Errorf("converting %s: %w", d.DevicePath, err)
		}
		doneBytes += d.CapacityBytes

		st, err := os.Stat(out)
		if err != nil {
			return fmt.Errorf("stat converted disk: %w", err)
		}
		log.Infof("Converted %s: %d bytes", href, st.Size())

		ovfIn.Disks = append(ovfIn.Disks, OVFDisk{
			Href:          href,
			FileSize:      st.Size(),
			CapacityBytes: d.CapacityBytes,
			BusType:       d.BusType,
			BootOrder:     d.BootOrder,
		})
		files = append(files, OvaFile{Name: href, Size: st.Size(), OpenAt: LocalFile(out)})
	}

	sw.set(func(s *ExportStatus) {
		s.Phase = PhaseAssembling
		s.Stage = "planning chunks"
		s.Percent = 100
		s.BytesDone = s.BytesTotal
	})

	// Chunking must be decided before the descriptor, because ovf:chunkSize and
	// ovf:size are descriptor content (DSP0243 clause 542-556).
	chunks, chunkSizes, err := PlanChunks(files, defaultChunkSize)
	if err != nil {
		return fmt.Errorf("planning chunks: %w", err)
	}
	for i := range ovfIn.Disks {
		if cs, ok := chunkSizes[ovfIn.Disks[i].Href]; ok {
			ovfIn.Disks[i].ChunkSize = cs
		}
	}

	descriptor, err := BuildOVF(ovfIn, Profile(spec.Profile))
	if err != nil {
		return fmt.Errorf("building OVF descriptor: %w", err)
	}

	sw.set(func(s *ExportStatus) { s.Stage = "hashing disks" })
	chunks, err = HashChunks(chunks)
	if err != nil {
		return fmt.Errorf("hashing chunks: %w", err)
	}

	// Write to .partial and rename, so a crash never leaves a file that looks
	// like a finished OVA.
	final := filepath.Join(root, spec.TargetName+".ova")
	partial := final + ".partial"
	sw.set(func(s *ExportStatus) { s.Stage = "writing OVA" })

	f, err := os.Create(partial)
	if err != nil {
		return fmt.Errorf("creating %s: %w", partial, err)
	}
	if err := WriteOVA(f, spec.TargetName, descriptor, chunks); err != nil {
		f.Close()
		os.Remove(partial)
		return fmt.Errorf("writing OVA: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(partial)
		return fmt.Errorf("closing %s: %w", partial, err)
	}
	if err := os.Rename(partial, final); err != nil {
		return fmt.Errorf("renaming to %s: %w", final, err)
	}

	st, err := os.Stat(final)
	if err != nil {
		return fmt.Errorf("stat final OVA: %w", err)
	}
	now := time.Now().UTC()
	sw.set(func(s *ExportStatus) {
		s.Phase = PhaseReady
		s.Stage = "done"
		s.OvaPath = final
		s.SizeBytes = st.Size()
		s.TarFormat = "USTAR"
		s.Chunked = len(chunkSizes) > 0
		s.FinishedAt = &now
	})
	log.Infof("Export complete: %s (%d bytes)", final, st.Size())
	return nil
}

// qemuProgress matches the "(12.34/100%)" that `qemu-img convert -p` emits.
var qemuProgress = regexp.MustCompile(`\((\d+\.\d+)/100%\)`)

// convertDisk runs qemu-img over a raw block device.
//
// The source is always raw: a KubeVirt PVC in Block mode is presented as an
// unformatted block device, so -f raw is both correct and important (it stops
// qemu-img probing guest content and guessing a format, which a malicious or
// unusual guest image could otherwise influence).
func convertDisk(device, out string, rules profileRules, onPercent func(float64)) error {
	args := []string{"convert", "-p", "-f", "raw", "-O", rules.qemuFormat}
	if opts := qemuOutputOpts(rules); opts != "" {
		args = append(args, "-o", opts)
	}
	args = append(args, device, out)

	cmd := exec.Command("qemu-img", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return err
	}
	go scanProgress(stdout, onPercent)

	if err := cmd.Wait(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("qemu-img: %s", msg)
	}
	return nil
}

// scanProgress reads qemu-img's carriage-return-delimited progress output.
func scanProgress(r io.Reader, onPercent func(float64)) {
	buf := make([]byte, 4096)
	var acc strings.Builder
	last := -1.0
	for {
		n, err := r.Read(buf)
		if n > 0 {
			acc.Write(buf[:n])
			if m := qemuProgress.FindAllStringSubmatch(acc.String(), -1); len(m) > 0 {
				var p float64
				fmt.Sscanf(m[len(m)-1][1], "%f", &p)
				// Only report whole-percent movement; the file is on shared
				// storage and rewriting it hundreds of times is wasteful.
				if p-last >= 1.0 {
					last = p
					onPercent(p)
				}
				acc.Reset()
			}
		}
		if err != nil {
			return
		}
	}
}

// qemuOutputOpts renders the -o argument for a profile. It is the single place
// the VMDK subformat and adapter type are chosen, so they cannot drift from the
// OVF ResourceSubType (see profileRules).
func qemuOutputOpts(r profileRules) string {
	var parts []string
	if r.qemuSubformat != "" {
		parts = append(parts, "subformat="+r.qemuSubformat)
	}
	if r.qemuAdapterType != "" {
		parts = append(parts, "adapter_type="+r.qemuAdapterType)
	}
	return strings.Join(parts, ",")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
