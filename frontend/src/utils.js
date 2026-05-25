// frontend/src/utils.js — Shared utility functions

export const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch (e) {
        return dateString;
    }
};

export const formatDuration = (start, end) => {
    if (!start) return 'N/A';
    const startMs = new Date(start).getTime();
    const endMs = end ? new Date(end).getTime() : Date.now();
    const diffMs = Math.max(0, endMs - startMs);
    const seconds = Math.floor(diffMs / 1000) % 60;
    const minutes = Math.floor(diffMs / 60000) % 60;
    const hours = Math.floor(diffMs / 3600000);
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
};

export const slugify = (text) =>
    text.toString().toLowerCase().trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+|-+$/g, '');

// Builds the VirtualMachineImport (VMIC) plan object from wizard state.
// metadata.name is slugified (RFC-1123 object name); spec.virtualMachineName
// is the RAW vCenter/OVA source name — VMIC locates the source VM by exact,
// case-sensitive name, so it must never be slugified.
export const buildVmicPlan = ({
    sourceType,
    ovaVmName,
    selectedVm,
    planName,
    targetNamespace,
    sourceName,
    sourceNamespace,
    storageClass,
    networkMappings = {},
    networkModels = {},
    capabilities = {},
    forcePowerOff,
    shutdownTimeout,
    defaultModel,
    skipPreflight,
    diskBus,
}) => {
    const sourceVmName = sourceType === 'ova' ? ovaVmName : (selectedVm?.name || '');
    const folder = (sourceType !== 'ova' && selectedVm?.folder && selectedVm.folder !== '/') ? selectedVm.folder : undefined;

    const plan = {
        apiVersion: 'migration.harvesterhci.io/v1beta1',
        kind: 'VirtualMachineImport',
        metadata: {
            name: slugify(planName),
            namespace: targetNamespace,
            annotations: sourceType === 'vmware' && selectedVm ? {
                'migration.harvesterhci.io/original-cpu': selectedVm.cpu?.toString() || '0',
                'migration.harvesterhci.io/original-memory-mb': selectedVm.memoryMB?.toString() || '0',
                'migration.harvesterhci.io/original-disk-size-gb': selectedVm.diskSizeGB?.toString() || '0',
                'migration.harvesterhci.io/original-disks': JSON.stringify(selectedVm.disks || []),
                'migration.harvesterhci.io/original-networks': JSON.stringify(selectedVm.networks || []),
            } : undefined,
        },
        spec: {
            virtualMachineName: sourceVmName,
            sourceCluster: {
                name: sourceName,
                namespace: sourceNamespace,
                kind: sourceType === 'ova' ? 'OvaSource' : 'VmwareSource',
                apiVersion: 'migration.harvesterhci.io/v1beta1',
            },
            storageClass: storageClass,
            networkMapping: Object.entries(networkMappings).map(([key, value]) => ({
                sourceNetwork: key,
                destinationNetwork: `${value}`,
                networkInterfaceModel: capabilities.hasAdvancedPower ? (networkModels[key] || undefined) : undefined,
            })),
            folder: folder,
        },
    };

    if (capabilities.hasAdvancedPower) {
        plan.spec.forcePowerOff = forcePowerOff;
        if (shutdownTimeout) {
            plan.spec.gracefulShutdownTimeoutSeconds = parseInt(shutdownTimeout);
        }
        if (defaultModel) {
            plan.spec.defaultNetworkInterfaceModel = defaultModel;
        }
        plan.spec.skipPreflightChecks = skipPreflight;
        if (diskBus) {
            plan.spec.defaultDiskBusType = diskBus;
        }
    }

    return plan;
};

// Flattens an inventory tree (InventoryNode, as captured in a support bundle's
// inventory/*.json) into the list of VM nodes. Each VM node already has the
// shape buildVmicPlan / the wizard consume as `selectedVm`.
export const extractVms = (node) => {
    if (!node) return [];
    const vms = [];
    if (node.type === 'VirtualMachine') {
        vms.push(node);
    }
    for (const child of node.children || []) {
        vms.push(...extractVms(child));
    }
    return vms;
};
