// frontend/src/utils.test.js
import fs from 'fs';
import path from 'path';
import { formatBytes, formatDate, formatDuration, slugify, buildVmicPlan, extractVms } from './utils';

describe('formatBytes', () => {
    test('returns "0 Bytes" for 0', () => {
        expect(formatBytes(0)).toBe('0 Bytes');
    });

    test('returns "0 Bytes" for null/undefined', () => {
        expect(formatBytes(null)).toBe('0 Bytes');
        expect(formatBytes(undefined)).toBe('0 Bytes');
    });

    test('formats bytes correctly', () => {
        expect(formatBytes(1024)).toBe('1 KB');
        expect(formatBytes(1048576)).toBe('1 MB');
        expect(formatBytes(1073741824)).toBe('1 GB');
        expect(formatBytes(1099511627776)).toBe('1 TB');
    });

    test('respects decimals parameter', () => {
        expect(formatBytes(1536, 0)).toBe('2 KB');
        expect(formatBytes(1536, 1)).toBe('1.5 KB');
        expect(formatBytes(1536, 2)).toBe('1.5 KB');
    });

    test('handles large values', () => {
        expect(formatBytes(5 * 1024 * 1024 * 1024, 1)).toBe('5 GB');
    });
});

describe('formatDate', () => {
    test('returns "N/A" for empty input', () => {
        expect(formatDate(null)).toBe('N/A');
        expect(formatDate(undefined)).toBe('N/A');
        expect(formatDate('')).toBe('N/A');
    });

    test('formats a valid ISO date string', () => {
        const result = formatDate('2024-01-15T10:30:00Z');
        // Should contain date parts (locale-dependent, but should not be N/A)
        expect(result).not.toBe('N/A');
        expect(result).toContain('2024');
    });

    test('returns the original string for invalid dates', () => {
        const result = formatDate('not-a-date');
        // Depending on browser, may return "Invalid Date" or the original
        expect(result).toBeTruthy();
    });
});

describe('formatDuration', () => {
    test('returns "N/A" for missing start', () => {
        expect(formatDuration(null)).toBe('N/A');
        expect(formatDuration(undefined)).toBe('N/A');
    });

    test('formats duration between two timestamps', () => {
        const start = '2024-01-15T10:00:00Z';
        const end = '2024-01-15T11:30:45Z';
        const result = formatDuration(start, end);
        expect(result).toBe('1h 30m 45s');
    });

    test('formats short durations', () => {
        const start = '2024-01-15T10:00:00Z';
        const end = '2024-01-15T10:00:30Z';
        expect(formatDuration(start, end)).toBe('30s');
    });

    test('formats minutes and seconds', () => {
        const start = '2024-01-15T10:00:00Z';
        const end = '2024-01-15T10:05:10Z';
        expect(formatDuration(start, end)).toBe('5m 10s');
    });

    test('handles zero duration', () => {
        const ts = '2024-01-15T10:00:00Z';
        expect(formatDuration(ts, ts)).toBe('0s');
    });
});

describe('slugify', () => {
    test('converts to lowercase', () => {
        expect(slugify('Hello World')).toBe('hello-world');
    });

    test('replaces spaces with hyphens', () => {
        expect(slugify('my vm name')).toBe('my-vm-name');
    });

    test('removes special characters', () => {
        expect(slugify('VM (Test) #1')).toBe('vm-test-1');
    });

    test('collapses multiple hyphens', () => {
        expect(slugify('a---b')).toBe('a-b');
    });

    test('strips leading/trailing hyphens', () => {
        expect(slugify('-hello-')).toBe('hello');
    });

    test('handles empty string', () => {
        expect(slugify('')).toBe('');
    });

    test('handles already-slugified input', () => {
        expect(slugify('my-vm-name')).toBe('my-vm-name');
    });

    test('handles complex VM names', () => {
        expect(slugify('Windows Server 2019 (Production)')).toBe('windows-server-2019-production');
    });
});

describe('buildVmicPlan', () => {
    // Simulated VM data captured from the debug log (teste.log) for vm-139860.
    // Mirrors what the inventory endpoint returns for this VM.
    const selectedVm = {
        id: 'vm-139860',
        name: 'VMDEVOPSTSTWIN01',
        cpu: 2,
        memoryMB: 4096,
        diskSizeGB: 40,
        folder: 'DESENVOLVIMENTO/WINDOWS/DEVOPS',
        powerState: 'poweredOff',
        datastoreId: 'datastore-10061',
        datastoreName: 'SVT_DS_SERVICOS_06',
        disks: [{ name: 'Hard disk 1', capacity: 96636764160, busType: 'scsi', unitNum: 0 }],
        networks: [{ name: 'VM Network - VLAN16', id: 'network-97256', mac: '00:50:56:9e:f5:aa', key: 4000 }],
    };

    const baseOpts = {
        sourceType: 'vmware',
        selectedVm,
        planName: 'teste',
        targetNamespace: 'devops',
        sourceName: 'import-vcenter',
        sourceNamespace: 'default',
        storageClass: 'harvester-longhorn2',
        networkMappings: { 'VM Network - VLAN16': 'devops/vlan16-apps-dev' },
        networkModels: { 'VM Network - VLAN16': 'e1000e' },
        capabilities: { hasAdvancedPower: true },
        forcePowerOff: false,
        skipPreflight: false,
    };

    // Regression guard for the slugify bug: VMIC locates the source VM by exact,
    // case-sensitive vCenter name, so spec.virtualMachineName must be the RAW name.
    test('spec.virtualMachineName keeps the raw, case-sensitive vCenter name', () => {
        const plan = buildVmicPlan(baseOpts);
        expect(plan.spec.virtualMachineName).toBe('VMDEVOPSTSTWIN01');
        expect(plan.spec.virtualMachineName).not.toBe(slugify('VMDEVOPSTSTWIN01'));
    });

    test('metadata.name is slugified (RFC-1123 object name)', () => {
        const plan = buildVmicPlan({ ...baseOpts, planName: 'Teste Plan 01' });
        expect(plan.metadata.name).toBe('teste-plan-01');
        expect(plan.metadata.namespace).toBe('devops');
    });

    test('network mapping reflects the discovered source network', () => {
        const plan = buildVmicPlan(baseOpts);
        expect(plan.spec.networkMapping).toEqual([
            {
                sourceNetwork: 'VM Network - VLAN16',
                destinationNetwork: 'devops/vlan16-apps-dev',
                networkInterfaceModel: 'e1000e',
            },
        ]);
    });

    test('folder and sourceCluster match the inventory record', () => {
        const plan = buildVmicPlan(baseOpts);
        expect(plan.spec.folder).toBe('DESENVOLVIMENTO/WINDOWS/DEVOPS');
        expect(plan.spec.sourceCluster).toEqual({
            name: 'import-vcenter',
            namespace: 'default',
            kind: 'VmwareSource',
            apiVersion: 'migration.harvesterhci.io/v1beta1',
        });
    });

    test('annotations capture the original VM specs verbatim', () => {
        const plan = buildVmicPlan(baseOpts);
        const ann = plan.metadata.annotations;
        expect(ann['migration.harvesterhci.io/original-cpu']).toBe('2');
        expect(ann['migration.harvesterhci.io/original-memory-mb']).toBe('4096');
        expect(ann['migration.harvesterhci.io/original-disk-size-gb']).toBe('40');
        expect(JSON.parse(ann['migration.harvesterhci.io/original-networks'])).toEqual(selectedVm.networks);
        expect(JSON.parse(ann['migration.harvesterhci.io/original-disks'])).toEqual(selectedVm.disks);
    });

    test('OVA source uses the raw OVA VM name and omits the folder', () => {
        const plan = buildVmicPlan({
            ...baseOpts,
            sourceType: 'ova',
            ovaVmName: 'MyAppliance_OVA',
            selectedVm: null,
        });
        expect(plan.spec.virtualMachineName).toBe('MyAppliance_OVA');
        expect(plan.spec.sourceCluster.kind).toBe('OvaSource');
        expect(plan.spec.folder).toBeUndefined();
    });

    test('advanced fields are omitted when the cluster lacks advanced power support', () => {
        const plan = buildVmicPlan({
            ...baseOpts,
            capabilities: { hasAdvancedPower: false },
        });
        expect(plan.spec.skipPreflightChecks).toBeUndefined();
        expect(plan.spec.forcePowerOff).toBeUndefined();
        expect(plan.spec.networkMapping[0].networkInterfaceModel).toBeUndefined();
    });
});

describe('extractVms', () => {
    test('flattens a tree and returns only VM nodes', () => {
        const tree = {
            type: 'datacenter', name: 'DC',
            children: [
                { type: 'Folder', name: 'F1', children: [
                    { type: 'VirtualMachine', name: 'vm-a' },
                    { type: 'VirtualMachine', name: 'vm-b' },
                ] },
                { type: 'Folder', name: 'F2', children: [
                    { type: 'Folder', name: 'F2a', children: [
                        { type: 'VirtualMachine', name: 'vm-c' },
                    ] },
                ] },
            ],
        };
        const names = extractVms(tree).map(v => v.name);
        expect(names).toEqual(['vm-a', 'vm-b', 'vm-c']);
    });

    test('returns [] for null/empty', () => {
        expect(extractVms(null)).toEqual([]);
        expect(extractVms({ type: 'Folder' })).toEqual([]);
    });
});

// Support-bundle replay: load every captured inventory/*.json fixture and run
// each VM through buildVmicPlan. Drop a real (redacted) bundle's inventory dir
// under __fixtures__/bundles/<name>/inventory/ and it's replayed automatically.
const RFC_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const bundlesRoot = path.join(__dirname, '__fixtures__', 'bundles');

function loadInventoryFixtures() {
    if (!fs.existsSync(bundlesRoot)) return [];
    const out = [];
    for (const bundle of fs.readdirSync(bundlesRoot)) {
        const invDir = path.join(bundlesRoot, bundle, 'inventory');
        if (!fs.existsSync(invDir)) continue;
        for (const f of fs.readdirSync(invDir)) {
            if (!f.endsWith('.json')) continue;
            const tree = JSON.parse(fs.readFileSync(path.join(invDir, f), 'utf8'));
            out.push({ name: `${bundle}/${f}`, tree });
        }
    }
    return out;
}

describe('support-bundle inventory replay', () => {
    const fixtures = loadInventoryFixtures();

    test('at least one inventory fixture is present', () => {
        expect(fixtures.length).toBeGreaterThan(0);
    });

    fixtures.forEach(({ name, tree }) => {
        describe(name, () => {
            const vms = extractVms(tree);

            test('contains VMs', () => {
                expect(vms.length).toBeGreaterThan(0);
            });

            vms.forEach(vm => {
                test(`VMIC plan for "${vm.name}" is valid and preserves the raw name`, () => {
                    const uniqueNets = [...new Set((vm.networks || []).map(n => n.name))];
                    const networkMappings = Object.fromEntries(
                        uniqueNets.map(n => [n, 'devops/target-net'])
                    );

                    const plan = buildVmicPlan({
                        sourceType: 'vmware',
                        selectedVm: vm,
                        planName: vm.name,
                        targetNamespace: 'devops',
                        sourceName: 'import-vcenter',
                        sourceNamespace: 'default',
                        storageClass: 'harvester-longhorn',
                        networkMappings,
                        networkModels: {},
                        capabilities: { hasAdvancedPower: true },
                    });

                    // Regression guard, replayed across real data: VMIC locates the
                    // source VM by exact, case-sensitive name — never slugified.
                    expect(plan.spec.virtualMachineName).toBe(vm.name);

                    // metadata.name is the RFC-1123 object name.
                    expect(plan.metadata.name).toBe(slugify(vm.name));
                    expect(plan.metadata.name).toMatch(RFC_1123);

                    // One NetworkMap entry per distinct source network on the VM.
                    expect(plan.spec.networkMapping).toHaveLength(uniqueNets.length);

                    // Annotations faithfully capture the source networks/disks.
                    expect(JSON.parse(plan.metadata.annotations['migration.harvesterhci.io/original-networks']))
                        .toEqual(vm.networks);
                    expect(JSON.parse(plan.metadata.annotations['migration.harvesterhci.io/original-disks']))
                        .toEqual(vm.disks);
                });
            });
        });
    });
});
