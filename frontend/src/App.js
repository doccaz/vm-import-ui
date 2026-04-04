import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, ChevronRight, Server, Folder, Cloud, HardDrive, ArrowRight, X, Loader, CheckCircle, Cpu, MemoryStick, Trash2, Edit, AlertTriangle, RefreshCw, List, Package, Info, ChevronUp, ChevronDown, Search, Play, Square, RotateCcw, Power, CheckCircle2, HelpCircle, XCircle, Network, Check, Palette, ExternalLink, Copy, Download } from 'lucide-react';
import { formatBytes, formatDate, formatDuration, slugify } from './utils';

const getNestedValue = (obj, path) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

// --- Copy to Clipboard Button ---
const CopyButton = ({ text, className = "" }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button onClick={handleCopy} className={`bg-gray-700 hover:bg-gray-600 p-2 rounded shadow-lg transition-opacity ${className}`} title="Copy to clipboard">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
    );
};

const DownloadButton = ({ text, filename, className = "" }) => {
    const handleDownload = () => {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };
    return (
        <button onClick={handleDownload} className={`bg-gray-700 hover:bg-gray-600 p-2 rounded shadow-lg transition-opacity ${className}`} title={`Download as ${filename}`}>
            <Download size={14} />
        </button>
    );
};

// --- Sortable Header Component ---
const SortableHeader = ({ label, sortKey, currentSort, onSort }) => {
    const isActive = currentSort.key === sortKey;
    return (
        <th
            className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider cursor-pointer hover:bg-app transition-colors"
            onClick={() => onSort(sortKey)}
        >
            <div className="flex items-center space-x-1">
                <span>{label}</span>
                <div className="flex flex-col">
                    <ChevronUp size={12} className={`${isActive && currentSort.direction === 'asc' ? 'text-blue-600' : 'opacity-30'}`} />
                    <ChevronDown size={12} className={`${isActive && currentSort.direction === 'desc' ? 'text-blue-600' : 'opacity-30'}`} />
                </div>
            </div>
        </th>
    );
};

// --- Components ---
const Header = ({ title, onButtonClick }) => (
    <div className="flex justify-between items-center mb-6 pb-4 border-b border-main">
        <h1 className="text-2xl font-semibold text-main">{title}</h1>
        {onButtonClick && (
            <button onClick={onButtonClick} className="flex items-center bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md shadow">
                <Plus size={20} className="mr-2" />
                Create
            </button>
        )}
    </div>
);

const getPlanStatus = (plan) => {
    if (plan.status?.importStatus) {
        return plan.status.importStatus;
    }
    if (plan.status?.conditions?.[0]?.type) {
        return plan.status.conditions[0].type;
    }
    return 'Pending';
};

const ResourceTable = ({ plans, onViewDetails, onDelete, onRun, sortConfig, onSort, expandedPlans, toggleExpand, selectedDisks, setSelectedDisks }) => {
    const renderStatusIcon = (status) => {
        if (status === 'True') return <CheckCircle2 size={14} className="text-green-500 mr-1" />;
        if (status === 'False') return <XCircle size={14} className="text-red-500 mr-1" />;
        return <HelpCircle size={14} className="text-secondary opacity-70 mr-1" />;
    };

    return (
        <div className="bg-card shadow-md rounded-lg overflow-x-auto border border-main">
            <table className="min-w-full divide-y divide-main">
                <thead className="bg-app opacity-90">
                    <tr>
                        <th className="px-4 py-3"></th>
                        <SortableHeader label="Created" sortKey="metadata.creationTimestamp" currentSort={sortConfig} onSort={onSort} />
                        <SortableHeader label="Name" sortKey="metadata.name" currentSort={sortConfig} onSort={onSort} />
                        <SortableHeader label="Status" sortKey="status.importStatus" currentSort={sortConfig} onSort={onSort} />
                        <SortableHeader label="VM Name" sortKey="spec.virtualMachineName" currentSort={sortConfig} onSort={onSort} />
                        <SortableHeader label="Target Namespace" sortKey="metadata.namespace" currentSort={sortConfig} onSort={onSort} />
                        <SortableHeader label="Storage Class" sortKey="spec.storageClass" currentSort={sortConfig} onSort={onSort} />
                        <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider"></th>
                    </tr>
                </thead>
                <tbody className="bg-card divide-y divide-main">
                    {plans.length === 0 ? (
                        <tr>
                            <td colSpan="8" className="px-6 py-4 text-center text-sm text-secondary">No migration plans found.</td>
                        </tr>
                    ) : (
                        plans.map(plan => (
                            <React.Fragment key={plan.metadata.uid}>
                                <tr className="hover:bg-app transition-colors">
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-secondary">
                                        <button onClick={() => toggleExpand(plan.metadata.uid)} className="p-1 hover:bg-app rounded-full transition-colors">
                                            {expandedPlans.has(plan.metadata.uid) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{formatDate(plan.metadata.creationTimestamp)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-main">{plan.metadata.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{getPlanStatus(plan)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{plan.spec?.virtualMachineName || 'N/A'}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{plan.metadata.namespace}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{plan.spec.storageClass}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2 pr-4">
                                        {(() => {
                                            const status = getPlanStatus(plan);
                                            const canRun = status && !['Completed', 'Running', 'ImportCompleted'].includes(status);
                                            return canRun ? (
                                                <button onClick={() => onRun(plan)} title="Run Now" className="text-green-600 hover:text-green-800"><Play size={18} /></button>
                                            ) : null;
                                        })()}
                                        <button onClick={() => { }} title="Edit" className="text-secondary hover:text-main cursor-not-allowed"><Edit size={18} /></button>
                                        <button onClick={() => onDelete(plan)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                                        <button onClick={() => onViewDetails(plan)} className="text-blue-600 hover:text-blue-800">Details</button>
                                    </td>
                                </tr>
                                {expandedPlans.has(plan.metadata.uid) && (
                                    <tr className="bg-app">
                                        <td colSpan="8" className="px-6 py-4">
                                            {(() => {
                                                const cpu = plan.status?.cpu || plan.metadata.annotations?.['migration.harvesterhci.io/original-cpu'];
                                                const mem = plan.status?.memoryMB || plan.metadata.annotations?.['migration.harvesterhci.io/original-memory-mb'];
                                                const disks = plan.status?.diskImportStatus || plan.status?.diskStatus || plan.status?.planStatus?.disks || [];
                                                const diskSizeGB = disks.length > 0
                                                    ? (disks.reduce((acc, d) => acc + (d.diskSize || d.size || 0), 0) / (1024 * 1024 * 1024)).toFixed(0)
                                                    : plan.metadata.annotations?.['migration.harvesterhci.io/original-disk-size-gb'];

                                                const annotationTitle = "Data from original VM characteristics (vCenter source)";

                                                return (cpu || mem || diskSizeGB) && (
                                                    <div className="mb-4 flex flex-wrap gap-4 text-[11px] p-2 bg-blue-500/10 rounded-md border border-blue-500/20 items-center">
                                                        <span className="font-bold text-blue-700 uppercase tracking-tight">Source Characteristics:</span>
                                                        <div className="flex items-center" title={!plan.status?.cpu && plan.metadata.annotations?.['migration.harvesterhci.io/original-cpu'] ? annotationTitle : undefined}>
                                                            <Cpu size={12} className="mr-1 text-secondary opacity-70" />
                                                            <span>{cpu || 'N/A'} vCPU</span>
                                                            {!plan.status?.cpu && plan.metadata.annotations?.['migration.harvesterhci.io/original-cpu'] && <span className="ml-0.5 text-blue-500 cursor-help">*</span>}
                                                        </div>
                                                        <div className="flex items-center" title={!plan.status?.memoryMB && plan.metadata.annotations?.['migration.harvesterhci.io/original-memory-mb'] ? annotationTitle : undefined}>
                                                            <MemoryStick size={12} className="mr-1 text-secondary opacity-70" />
                                                            <span>{mem ? formatBytes(parseInt(mem) * 1024 * 1024, 0) : 'N/A'}</span>
                                                            {!plan.status?.memoryMB && plan.metadata.annotations?.['migration.harvesterhci.io/original-memory-mb'] && <span className="ml-0.5 text-blue-500 cursor-help">*</span>}
                                                        </div>
                                                        <div className="flex items-center" title={!plan.status?.diskImportStatus && plan.metadata.annotations?.['migration.harvesterhci.io/original-disk-size-gb'] ? annotationTitle : undefined}>
                                                            <HardDrive size={12} className="mr-1 text-secondary opacity-70" />
                                                            <span>
                                                                {diskSizeGB || 'N/A'} GB
                                                                {(() => {
                                                                    const originalDiskGB = plan.metadata.annotations?.['migration.harvesterhci.io/original-disk-size-gb'];
                                                                    if (disks.length > 0 && originalDiskGB && originalDiskGB !== diskSizeGB) {
                                                                        return <span className="text-secondary opacity-70 ml-1">({originalDiskGB} GB originally)</span>;
                                                                    }
                                                                    return null;
                                                                })()}
                                                            </span>
                                                            {!(disks.length > 0) && plan.metadata.annotations?.['migration.harvesterhci.io/original-disk-size-gb'] && <span className="ml-0.5 text-blue-500 cursor-help">*</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <h4 className="text-xs font-bold text-secondary uppercase tracking-wider mb-2">Import Conditions</h4>
                                                    <div className="space-y-1 max-h-48 overflow-y-auto pr-2">
                                                        {(plan.status?.importConditions || plan.status?.conditions || []).map((c, i) => (
                                                            <div key={i} className="flex items-start text-sm border-b border-gray-50 last:border-0 pb-1">
                                                                <span className="mt-0.5">{renderStatusIcon(c.status || c.Status)}</span>
                                                                <div className="flex-grow">
                                                                    <div className="flex justify-between items-center">
                                                                        <span className="font-medium text-main">{c.type || c.Type}</span>
                                                                        <span className="text-[10px] text-secondary opacity-70 font-mono">{formatDate(c.lastTransitionTime || c.lastUpdateTime || c.LastUpdateTime)}</span>
                                                                    </div>
                                                                    <div className="text-secondary text-xs italic">{c.message || c.Message || (c.status === 'True' ? 'Step completed successfully' : '')}</div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {(!plan.status?.importConditions && (!plan.status?.conditions || plan.status.conditions.length === 0)) && <p className="text-xs text-secondary italic">No conditions reported yet.</p>}
                                                    </div>
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-bold text-secondary uppercase tracking-wider mb-2">Disk Import Status</h4>
                                                    <div className="space-y-3">
                                                        {(() => {
                                                            const disks = plan.status?.diskImportStatus || plan.status?.diskStatus || plan.status?.planStatus?.disks || [];
                                                            if (disks.length === 0) return <p className="text-xs text-secondary italic">No disk progress reported yet.</p>;

                                                            const diskIndex = selectedDisks[plan.metadata.uid] || 0;
                                                            const d = disks[diskIndex] || disks[0];

                                                            return (
                                                                <div className="space-y-4">
                                                                    {disks.length > 1 && (
                                                                        <div className="flex items-center space-x-2">
                                                                            <label className="text-[10px] font-bold text-secondary opacity-70 uppercase">Select Disk:</label>
                                                                            <select
                                                                                className="text-xs border rounded pl-1 pr-8 py-0.5 bg-card focus:outline-none focus:ring-1 focus:ring-blue-500 form-select"
                                                                                value={diskIndex}
                                                                                onChange={(e) => setSelectedDisks(prev => ({ ...prev, [plan.metadata.uid]: parseInt(e.target.value, 10) }))}
                                                                            >
                                                                                {disks.map((disk, idx) => (
                                                                                    <option key={idx} value={idx}>
                                                                                        {disk.diskName || disk.name || disk.Name || `Disk ${idx}`}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    )}

                                                                    <div className="text-sm bg-card p-3 rounded border shadow-sm">
                                                                        <div className="flex justify-between items-start mb-1">
                                                                            <div className="flex flex-col truncate mr-2">
                                                                                <span className="font-medium text-main truncate" title={d.diskName || d.name || d.Name}>{d.diskName || d.name || d.Name || `Disk ${diskIndex}`}</span>
                                                                                <span className="text-[10px] text-secondary opacity-70 font-mono">Size: {formatBytes(d.diskSize || d.size || 0)}</span>
                                                                            </div>
                                                                        </div>

                                                                        <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                                                            <h5 className="text-[10px] font-bold text-secondary opacity-70 uppercase tracking-tight">Disk Events</h5>
                                                                            {(() => {
                                                                                const conditions = d.diskConditions || d.conditions || [];
                                                                                return conditions.length > 0 ? (
                                                                                    conditions.map((c, ci) => (
                                                                                        <div key={`${diskIndex}-${ci}`} className="flex items-start text-[11px] border-b border-gray-50 last:border-0 pb-1">
                                                                                            <span className="mt-0.5">{renderStatusIcon(c.status || c.Status)}</span>
                                                                                            <div className="flex-grow">
                                                                                                <div className="flex justify-between items-center">
                                                                                                    <span className="font-medium text-main">{c.type || c.Type}</span>
                                                                                                    <span className="text-[9px] text-secondary opacity-70 font-mono">{formatDate(c.lastTransitionTime || c.lastUpdateTime || c.LastUpdateTime)}</span>
                                                                                                </div>
                                                                                                <div className="text-secondary text-[10px] leading-tight">{c.message || c.Message || (c.status === 'True' || c.Status === 'True' ? 'Task completed' : '')}</div>
                                                                                            </div>
                                                                                        </div>
                                                                                    ))
                                                                                ) : (
                                                                                    <p className="text-[10px] text-secondary opacity-70 italic">{d.status || d.Status || 'Initialising...'}</p>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
};

const getVmwareSourceStatus = (source) => {
    const statusText = source.status?.status || 'Pending';
    const conditions = source.status?.conditions || [];
    const hasError = conditions.some(c => c.type === 'ClusterError' && c.status === 'True');
    const isReady = conditions.some(c => c.type === 'ClusterReady' && c.status === 'True');

    let color = 'bg-app text-main';
    let label = statusText;
    if (isReady) {
        color = 'bg-green-100 text-green-800';
        label = 'Ready';
    } else if (hasError) {
        color = 'bg-red-100 text-red-800';
        label = statusText === 'clusterNotReady' ? 'Not Ready' : statusText;
    } else if (statusText === 'clusterReady') {
        color = 'bg-green-100 text-green-800';
        label = 'Ready';
    } else if (statusText === 'clusterNotReady') {
        color = 'bg-yellow-100 text-yellow-800';
        label = 'Not Ready';
    }
    return { label, color };
};

const SourcesTable = ({ sources, onEdit, onDelete, onViewDetails, onExplore, sortConfig, onSort }) => (
    <div className="bg-card shadow-md rounded-lg overflow-x-auto border border-main">
        <table className="min-w-full divide-y divide-main">
            <thead className="bg-app opacity-90">
                <tr>
                    <SortableHeader label="Created" sortKey="metadata.creationTimestamp" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Name" sortKey="metadata.name" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Namespace" sortKey="metadata.namespace" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Endpoint" sortKey="spec.endpoint" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Status" sortKey="status.status" currentSort={sortConfig} onSort={onSort} />
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider"></th>
                </tr>
            </thead>
            <tbody className="bg-card divide-y divide-main">
                {sources.length === 0 ? (
                    <tr>
                        <td colSpan="6" className="px-6 py-4 text-center text-sm text-secondary">No vCenter sources found.</td>
                    </tr>
                ) : (
                    sources.map(source => (
                        <tr key={source.metadata.uid} className="hover:bg-app">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{formatDate(source.metadata.creationTimestamp)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-main">{source.metadata.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{source.metadata.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{source.spec.endpoint}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                {(() => {
                                    const { label, color } = getVmwareSourceStatus(source);
                                    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>;
                                })()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                <button onClick={() => onExplore(source)} title="Explore Inventory" className="text-indigo-600 hover:text-indigo-800"><Search size={18} /></button>
                                <button onClick={() => onEdit(source)} title="Edit" className="text-blue-600 hover:text-blue-800"><Edit size={18} /></button>
                                <button onClick={() => onDelete(source)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                                <button onClick={() => onViewDetails(source)} className="text-blue-600 hover:text-blue-800">Details</button>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    </div>
);

const SourceWizard = ({ onCancel, onSave, source }) => {
    const [name, setName] = useState('');
    const [namespace, setNamespace] = useState('default');
    const [endpoint, setEndpoint] = useState('');
    const [datacenter, setDatacenter] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const isEditMode = !!source;

    useEffect(() => {
        if (isEditMode) {
            setName(source.metadata.name);
            setNamespace(source.metadata.namespace);
            setEndpoint(source.spec.endpoint);
            setDatacenter(source.spec.dc);
            setUsername(source.spec.username || '');
        }
    }, [source, isEditMode]);

    const handleSubmit = () => {
        const payload = { name, namespace, endpoint, datacenter, username, password };
        onSave(payload, isEditMode);
    };

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-lg">
                <div className="p-4 border-b">
                    <h2 className="text-xl font-semibold">{isEditMode ? 'Edit' : 'Create'} vCenter Source</h2>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-main">Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Namespace</label>
                        <input type="text" value={namespace} onChange={e => setNamespace(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">vCenter Endpoint URL</label>
                        <input type="text" placeholder="https://vcenter.your-domain.com/sdk" value={endpoint} onChange={e => setEndpoint(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Datacenter Name</label>
                        <input type="text" value={datacenter} onChange={e => setDatacenter(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Username</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full form-input" placeholder={isEditMode ? "Leave blank to keep existing password" : ""} />
                    </div>
                </div>
                <div className="p-4 border-t flex justify-end space-x-2">
                    <button onClick={onCancel} className="btn-secondary">Cancel</button>
                    <button onClick={handleSubmit} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md">Save</button>
                </div>
            </div>
        </div>
    );
};

const SourceDetails = ({ source, onClose }) => {
    const [yamlContent, setYamlContent] = useState('');
    const [showYaml, setShowYaml] = useState(false);
    const [isLoadingYaml, setIsLoadingYaml] = useState(false);

    const fetchYaml = async () => {
        setIsLoadingYaml(true);
        try {
            const response = await fetch(`/api/v1/harvester/vmwaresources/${source.metadata.namespace}/${source.metadata.name}/yaml`);
            const data = await response.text();
            setYamlContent(data || "Could not generate YAML.");
        } catch (err) {
            setYamlContent("Failed to fetch YAML.");
        } finally {
            setIsLoadingYaml(false);
        }
    };

    const handleShowYaml = () => {
        if (showYaml) {
            setShowYaml(false);
        } else {
            setShowYaml(true);
            fetchYaml();
        }
    };

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold text-main">{source.metadata.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <h3 className="text-lg font-medium text-main mb-2">Source Summary</h3>
                        <div className="p-3 bg-app rounded-md border text-sm space-y-1">
                            <p><strong>Endpoint:</strong> {source.spec.endpoint}</p>
                            <p><strong>Datacenter:</strong> {source.spec.dc}</p>
                            <p><strong>Credentials Secret:</strong> {source.spec.credentials.namespace}/{source.spec.credentials.name}</p>
                        </div>
                    </div>
                    <div>
                        <button onClick={handleShowYaml} className="text-sm text-blue-600 hover:underline">
                            {showYaml ? 'Hide' : 'View'} YAML
                        </button>
                        {showYaml && (
                            <div className="mt-2 p-2 border rounded-md bg-gray-900 text-white font-mono text-xs max-h-64 overflow-y-auto relative group">
                                <CopyButton text={yamlContent} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100" />
                                <pre>{isLoadingYaml ? 'Loading...' : yamlContent}</pre>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t bg-app text-right rounded-b-lg">
                    <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-md font-semibold transition-colors">Close</button>
                </div>
            </div>
        </div>
    );
};

const getOvaSourceStatus = (source) => {
    const statusText = source.status?.status || 'Pending';
    const conditions = source.status?.conditions || [];
    const hasError = conditions.some(c => c.type === 'ClusterError' && c.status === 'True');
    const isReady = conditions.some(c => c.type === 'ClusterReady' && c.status === 'True');

    let color = 'bg-app text-main';
    let label = statusText;
    if (isReady) {
        color = 'bg-green-100 text-green-800';
        label = 'Ready';
    } else if (hasError) {
        color = 'bg-red-100 text-red-800';
        label = statusText === 'clusterNotReady' ? 'Not Ready' : statusText;
    } else if (statusText === 'clusterReady') {
        color = 'bg-green-100 text-green-800';
        label = 'Ready';
    } else if (statusText === 'clusterNotReady') {
        color = 'bg-yellow-100 text-yellow-800';
        label = 'Not Ready';
    }
    return { label, color };
};

const OvaSourcesTable = ({ sources, onEdit, onDelete, onViewDetails, sortConfig, onSort }) => (
    <div className="bg-card shadow-md rounded-lg overflow-x-auto border border-main">
        <table className="min-w-full divide-y divide-main">
            <thead className="bg-app opacity-90">
                <tr>
                    <SortableHeader label="Created" sortKey="metadata.creationTimestamp" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Name" sortKey="metadata.name" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Namespace" sortKey="metadata.namespace" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="URL" sortKey="spec.url" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Status" sortKey="status.status" currentSort={sortConfig} onSort={onSort} />
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider"></th>
                </tr>
            </thead>
            <tbody className="bg-card divide-y divide-main">
                {sources.length === 0 ? (
                    <tr>
                        <td colSpan="6" className="px-6 py-4 text-center text-sm text-secondary">No OVA sources found.</td>
                    </tr>
                ) : (
                    sources.map(source => (
                        <tr key={source.metadata.uid} className="hover:bg-app">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{formatDate(source.metadata.creationTimestamp)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-main">{source.metadata.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{source.metadata.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary max-w-xs truncate" title={source.spec.url}>{source.spec.url}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                {(() => {
                                    const { label, color } = getOvaSourceStatus(source);
                                    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>;
                                })()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                <button onClick={() => onEdit(source)} title="Edit" className="text-blue-600 hover:text-blue-800"><Edit size={18} /></button>
                                <button onClick={() => onDelete(source)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                                <button onClick={() => onViewDetails(source)} className="text-blue-600 hover:text-blue-800">Details</button>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    </div>
);

const OvaSourceWizard = ({ onCancel, onSave, source }) => {
    const [name, setName] = useState('');
    const [namespace, setNamespace] = useState('default');
    const [url, setUrl] = useState('');
    const [httpTimeoutSeconds, setHttpTimeoutSeconds] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const isEditMode = !!source;

    useEffect(() => {
        if (isEditMode) {
            setName(source.metadata.name);
            setNamespace(source.metadata.namespace);
            setUrl(source.spec.url || '');
            setHttpTimeoutSeconds(source.spec.httpTimeoutSeconds || '');
            setUsername(source.spec.username || '');
        }
    }, [source, isEditMode]);

    const handleSubmit = () => {
        const payload = {
            name,
            namespace,
            url,
            httpTimeoutSeconds: httpTimeoutSeconds ? parseInt(httpTimeoutSeconds, 10) : 0,
            username,
            password
        };
        onSave(payload, isEditMode);
    };

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-lg">
                <div className="p-4 border-b">
                    <h2 className="text-xl font-semibold">{isEditMode ? 'Edit' : 'Create'} OVA Source</h2>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-main">Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Namespace</label>
                        <input type="text" value={namespace} onChange={e => setNamespace(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">OVA File URL</label>
                        <input type="text" placeholder="http://192.168.0.1:8080/example.ova" value={url} onChange={e => setUrl(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">HTTP Timeout (Seconds)</label>
                        <input type="number" placeholder="Optional. Default is 600" value={httpTimeoutSeconds} onChange={e => setHttpTimeoutSeconds(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Username</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full form-input" placeholder="Optional" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full form-input" placeholder={isEditMode ? "Leave blank to keep existing password" : "Optional"} />
                    </div>
                </div>
                <div className="p-4 border-t flex justify-end space-x-2">
                    <button onClick={onCancel} className="btn-secondary">Cancel</button>
                    <button onClick={handleSubmit} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md">Save</button>
                </div>
            </div>
        </div>
    );
};

const OvaSourceDetails = ({ source, onClose }) => {
    const [yamlContent, setYamlContent] = useState('');
    const [showYaml, setShowYaml] = useState(false);
    const [isLoadingYaml, setIsLoadingYaml] = useState(false);

    const fetchYaml = async () => {
        setIsLoadingYaml(true);
        try {
            const response = await fetch(`/api/v1/harvester/ovasources/${source.metadata.namespace}/${source.metadata.name}/yaml`);
            const data = await response.text();
            setYamlContent(data || "Could not generate YAML.");
        } catch (err) {
            setYamlContent("Failed to fetch YAML.");
        } finally {
            setIsLoadingYaml(false);
        }
    };

    const handleShowYaml = () => {
        if (showYaml) {
            setShowYaml(false);
        } else {
            setShowYaml(true);
            fetchYaml();
        }
    };

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold text-main">{source.metadata.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <h3 className="text-lg font-medium text-main mb-2">Source Summary</h3>
                        <div className="p-3 bg-app rounded-md border text-sm space-y-1">
                            <p><strong>URL:</strong> {source.spec.url}</p>
                            <p><strong>HTTP Timeout:</strong> {source.spec.httpTimeoutSeconds || '600'}s</p>
                            <p><strong>Credentials Secret:</strong> {source.spec.credentials.namespace}/{source.spec.credentials.name}</p>
                        </div>
                    </div>
                    <div>
                        <button onClick={handleShowYaml} className="text-sm text-blue-600 hover:underline">
                            {showYaml ? 'Hide' : 'View'} YAML
                        </button>
                        {showYaml && (
                            <div className="mt-2 p-2 border rounded-md bg-gray-900 text-white font-mono text-xs max-h-64 overflow-y-auto relative group">
                                <CopyButton text={yamlContent} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100" />
                                <pre>{isLoadingYaml ? 'Loading...' : yamlContent}</pre>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t bg-app text-right rounded-b-lg">
                    <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-md font-semibold transition-colors">Close</button>
                </div>
            </div>
        </div>
    );
};

const PlanDetails = ({ plan, onClose }) => {
    const [logs, setLogs] = useState('');
    const [yamlContent, setYamlContent] = useState('');
    const [showDebug, setShowDebug] = useState(null); // 'logs' or 'yaml'
    const [isLoadingDebug, setIsLoadingDebug] = useState(false);
    const [onlyRelevantLogs, setOnlyRelevantLogs] = useState(true);
    const [followLogs, setFollowLogs] = useState(true);
    const followLogsRef = useRef(true);
    const [fontSize, setFontSize] = useState(10); // px
    const logsEndRef = useRef(null);

    useEffect(() => { followLogsRef.current = followLogs; }, [followLogs]);

    const fetchLogs = useCallback(async (showAll = !onlyRelevantLogs, isBackground = false) => {
        if (!isBackground) setIsLoadingDebug(true);
        try {
            const response = await fetch(`/api/v1/plans/${plan.metadata.namespace}/${plan.metadata.name}/logs${showAll ? '?all=true' : ''}`);
            const data = await response.text();
            setLogs(data || "No logs found.");
        } catch (err) {
            setLogs("Failed to fetch logs.");
        } finally {
            if (!isBackground) setIsLoadingDebug(false);
        }
    }, [onlyRelevantLogs, plan.metadata.namespace, plan.metadata.name]);

    useEffect(() => {
        let interval;
        if (showDebug === 'logs') {
            interval = setInterval(() => {
                if (followLogsRef.current) fetchLogs(!onlyRelevantLogs, true);
            }, 2000);
        }
        return () => clearInterval(interval);
    }, [showDebug, onlyRelevantLogs, plan.metadata.namespace, plan.metadata.name, fetchLogs]);

    useEffect(() => {
        if (followLogs && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, followLogs]);

    const fetchYaml = async () => {
        setIsLoadingDebug(true);
        try {
            const response = await fetch(`/api/v1/plans/${plan.metadata.namespace}/${plan.metadata.name}/yaml`);
            const data = await response.text();
            setYamlContent(data || "Could not generate YAML.");
        } catch (err) {
            setYamlContent("Failed to fetch YAML.");
        } finally {
            setIsLoadingDebug(false);
        }
    };

    const handleShowDebug = (type) => {
        if (showDebug === type) {
            setShowDebug(null); // Toggle off
            return;
        }
        setShowDebug(type);
        if (type === 'logs') {
            fetchLogs();
        } else if (type === 'yaml') {
            fetchYaml();
        }
    };

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-[768px] max-w-[95vw] min-h-[50vh] flex flex-col max-h-[95vh] resize overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold text-main">{plan.metadata.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h3 className="text-lg font-medium text-main mb-2">VM Characteristics</h3>
                            <div className="p-3 bg-app rounded-md border text-sm space-y-2">
                                {(() => {
                                    const getAnnotation = (key) => plan.metadata.annotations?.[key];
                                    const originalCpu = getAnnotation('migration.harvesterhci.io/original-cpu');
                                    const originalMemoryMB = getAnnotation('migration.harvesterhci.io/original-memory-mb');
                                    const originalDiskGB = getAnnotation('migration.harvesterhci.io/original-disk-size-gb');

                                    const cpu = plan.status?.cpu || originalCpu;
                                    const memoryMB = plan.status?.memoryMB || originalMemoryMB;
                                    const diskSizeGB = plan.status?.diskImportStatus
                                        ? (plan.status.diskImportStatus.reduce((acc, d) => acc + (d.diskSize || d.size || 0), 0) / (1024 * 1024 * 1024)).toFixed(0)
                                        : originalDiskGB;

                                    const annotationTitle = "Data from original VM characteristics (vCenter source)";

                                    return (
                                        <>
                                            <div className="flex items-center">
                                                <Cpu size={16} className="mr-2 text-secondary" />
                                                <span>
                                                    {cpu || 'N/A'} vCPU(s)
                                                    {plan.status?.cpu && originalCpu && originalCpu !== cpu && (
                                                        <span className="text-secondary opacity-70 ml-1">({originalCpu} originally)</span>
                                                    )}
                                                </span>
                                                {!plan.status?.cpu && originalCpu && (
                                                    <span className="ml-1 text-blue-500 cursor-help" title={annotationTitle}>*</span>
                                                )}
                                            </div>
                                            <div className="flex items-center">
                                                <MemoryStick size={16} className="mr-2 text-secondary" />
                                                <span>
                                                    {memoryMB ? formatBytes(parseInt(memoryMB) * 1024 * 1024, 0) : 'N/A'} Memory
                                                    {plan.status?.memoryMB && originalMemoryMB && originalMemoryMB !== memoryMB && (
                                                        <span className="text-secondary opacity-70 ml-1">({formatBytes(parseInt(originalMemoryMB) * 1024 * 1024, 0)} originally)</span>
                                                    )}
                                                </span>
                                                {!plan.status?.memoryMB && originalMemoryMB && (
                                                    <span className="ml-1 text-blue-500 cursor-help" title={annotationTitle}>*</span>
                                                )}
                                            </div>
                                            <div className="flex items-center">
                                                <HardDrive size={16} className="mr-2 text-secondary" />
                                                <span>
                                                    {diskSizeGB || 'N/A'} GB Storage
                                                    {plan.status?.diskImportStatus && originalDiskGB && originalDiskGB !== diskSizeGB && (
                                                        <span className="text-secondary opacity-70 ml-1">({originalDiskGB} GB originally)</span>
                                                    )}
                                                </span>
                                                {!plan.status?.diskImportStatus && originalDiskGB && (
                                                    <span className="ml-1 text-blue-500 cursor-help" title={annotationTitle}>*</span>
                                                )}
                                            </div>
                                        </>
                                    );
                                })()}
                                <div className="flex items-center">
                                    <Folder size={16} className="mr-2 text-secondary" />
                                    <span>{plan.spec?.folder || '/'}</span>
                                </div>
                                {plan.vms?.[0]?.networks?.[0]?.mac && (
                                    <div className="flex items-center text-xs text-secondary pt-1 border-t">
                                        <Network size={14} className="mr-2" />
                                        <span className="font-mono">Source MAC: {plan.vms[0].networks[0].mac}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div>
                            <h3 className="text-lg font-medium text-main mb-2 font-sans border-b pb-1">Configuration Parameters</h3>
                            <div className="p-3 bg-card rounded-md border shadow-sm text-xs space-y-2">
                                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                    <span className="text-secondary font-medium">VM Name:</span>
                                    <span className="text-main break-all font-semibold">{plan.spec?.virtualMachineName || 'N/A'}</span>

                                    <span className="text-secondary font-medium">Source:</span>
                                    <span className="text-main break-all">{plan.spec?.sourceCluster?.namespace}/{plan.spec?.sourceCluster?.name || 'N/A'}</span>

                                    <span className="text-secondary font-medium">Storage Class:</span>
                                    <span className="text-main">{plan.spec?.storageClass || 'N/A'}</span>

                                    <span className="text-secondary font-medium">Force Power Off:</span>
                                    <span className={plan.spec?.forcePowerOff ? "text-orange-600 font-bold" : "text-secondary opacity-70"}>{plan.spec?.forcePowerOff ? "Yes" : "No"}</span>

                                    <span className="text-secondary font-medium">Shutdown Timeout:</span>
                                    <span className="text-main">{plan.spec?.gracefulShutdownTimeoutSeconds || '0'}s</span>

                                    <span className="text-secondary font-medium">Skip Validation:</span>
                                    <span className={plan.spec?.skipPreflightChecks ? "text-blue-600 font-bold" : "text-secondary opacity-70"}>{plan.spec?.skipPreflightChecks ? "Yes" : "No"}</span>

                                    <span className="text-secondary font-medium">Default Disk Bus:</span>
                                    <span className="text-main">{plan.spec?.defaultDiskBusType || 'virtio'}</span>

                                    <span className="text-secondary font-medium">Default Net Model:</span>
                                    <span className="text-main">{plan.spec?.defaultNetworkInterfaceModel || 'virtio'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h3 className="text-lg font-medium text-main mb-2 font-sans border-b pb-1">Network Mappings</h3>
                            <div className="bg-card border rounded-lg shadow-sm overflow-hidden text-[10px]">
                                <table className="min-w-full divide-y divide-main">
                                    <thead className="bg-app">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-bold text-secondary uppercase tracking-tight">Source Net</th>
                                            <th className="px-3 py-2 text-left font-bold text-secondary uppercase tracking-tight">Target VLAN</th>
                                            <th className="px-3 py-2 text-left font-bold text-secondary uppercase tracking-tight">Model</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-main">
                                        {(plan.spec?.networkMapping || []).map((net, i) => (
                                            <tr key={i} className="hover:bg-app transition-colors">
                                                <td className="px-3 py-2 text-main">{net.sourceNetwork}</td>
                                                <td className="px-3 py-2 text-blue-600 font-medium">{net.destinationNetwork}</td>
                                                <td className="px-3 py-2 text-secondary font-mono italic">{net.networkInterfaceModel || plan.spec?.defaultNetworkInterfaceModel || 'virtio'}</td>
                                            </tr>
                                        ))}
                                        {(!plan.spec?.networkMapping || plan.spec.networkMapping.length === 0) && (
                                            <tr><td colSpan="3" className="px-3 py-4 text-center text-xs text-secondary italic">No network mappings defined.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div>
                            <h3 className="text-lg font-medium text-main mb-2 font-sans border-b pb-1">Disks</h3>
                            <div className="bg-card border rounded-lg shadow-sm overflow-hidden text-[10px]">
                                <table className="min-w-full divide-y divide-main">
                                    <thead className="bg-app">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-bold text-secondary uppercase tracking-tight">Source Disk</th>
                                            <th className="px-3 py-2 text-left font-bold text-secondary uppercase tracking-tight">Size</th>
                                            <th className="px-3 py-2 text-left font-bold text-secondary uppercase tracking-tight">Storage Class</th>
                                            <th className="px-3 py-2 text-left font-bold text-secondary uppercase tracking-tight">Bus</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-main">
                                        {(plan.status?.diskImportStatus || plan.spec?.disks || []).length > 0 ? (
                                            (plan.status?.diskImportStatus || plan.spec?.disks || []).map((disk, i) => {
                                                const name = disk.diskName || disk.sourceDisk || (i === 0 ? "Root Disk" : `Disk ${i}`);
                                                const size = disk.diskSize ? formatBytes(disk.diskSize) :
                                                    (disk.sizeGB || disk.size ? (disk.sizeGB || disk.size) + ' GB' : 'N/A');
                                                const sc = disk.storageClass || plan.spec?.storageClass || 'default';
                                                const bus = disk.busType || disk.bus || plan.spec?.defaultDiskBusType || 'virtio';

                                                return (
                                                    <tr key={i} className="hover:bg-app transition-colors">
                                                        <td className="px-3 py-2 text-main truncate max-w-[120px]" title={name}>{name}</td>
                                                        <td className="px-3 py-2 text-main font-medium">{size}</td>
                                                        <td className="px-3 py-2 text-xs text-main">{sc}</td>
                                                        <td className="px-3 py-2 text-secondary font-mono italic uppercase">{bus}</td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            <tr className="hover:bg-app transition-colors">
                                                <td className="px-3 py-2 text-main font-medium">Root Disk</td>
                                                <td className="px-3 py-2 text-main font-medium">{plan.vms?.[0]?.diskSizeGB || 'N/A'} GB</td>
                                                <td className="px-3 py-2 text-xs text-main">{plan.spec?.storageClass || 'default'}</td>
                                                <td className="px-3 py-2 text-secondary font-mono italic">{plan.spec?.defaultDiskBusType || 'virtio'}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="flex space-x-4 border-b">
                            <button
                                onClick={() => handleShowDebug('logs')}
                                className={`pb-2 text-sm font-medium transition-colors ${showDebug === 'logs' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-secondary hover:text-main'}`}
                            >
                                Debug Logs
                            </button>
                            <button
                                onClick={() => handleShowDebug('yaml')}
                                className={`pb-2 text-sm font-medium transition-colors ${showDebug === 'yaml' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-secondary hover:text-main'}`}
                            >
                                View YAML
                            </button>
                            {showDebug && (
                                <div className="flex items-center space-x-4 ml-auto pb-2">
                                    <div className="flex items-center text-xs space-x-2">
                                        <button onClick={() => setFontSize(Math.max(6, fontSize - 1))} className="text-secondary hover:text-main font-bold px-1.5 bg-app rounded border hover:bg-gray-200">-A</button>
                                        <span className="text-secondary font-mono w-8 text-center">{fontSize}px</span>
                                        <button onClick={() => setFontSize(Math.min(24, fontSize + 1))} className="text-secondary hover:text-main font-bold px-1.5 bg-app rounded border hover:bg-gray-200">+A</button>
                                    </div>
                                    {showDebug === 'logs' && <>
                                        <label className="flex items-center text-xs text-secondary opacity-70 cursor-pointer">
                                            <input type="checkbox" checked={followLogs} onChange={(e) => setFollowLogs(e.target.checked)} className="mr-1 h-3 w-3" />
                                            Follow
                                        </label>
                                        <label className="flex items-center text-xs text-secondary opacity-70 cursor-pointer">
                                            <input type="checkbox" checked={onlyRelevantLogs}
                                                onChange={(e) => { const newVal = e.target.checked; setOnlyRelevantLogs(newVal); fetchLogs(!newVal, false); }}
                                                className="mr-1 h-3 w-3" />
                                            Only relevant
                                        </label>
                                        <button onClick={() => fetchLogs(!onlyRelevantLogs, false)} className="text-secondary hover:text-main" title="Refresh logs"><RefreshCw size={14} /></button>
                                    </>}
                                </div>
                            )}
                        </div>
                        {showDebug && (
                            <div className="mt-4 p-4 border rounded-md bg-gray-900 text-white font-mono max-h-96 overflow-y-auto shadow-inner group relative" style={{ fontSize: `${fontSize}px` }}>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100">
                                    <DownloadButton text={showDebug === 'logs' ? logs : yamlContent} filename={showDebug === 'logs' ? `${plan.metadata.name}-logs.txt` : `${plan.metadata.name}.yaml`} />
                                    <CopyButton text={showDebug === 'logs' ? logs : yamlContent} />
                                </div>
                                {isLoadingDebug ? (
                                    <div className="flex items-center space-x-3 p-4">
                                        <Loader className="animate-spin text-blue-400" size={18} />
                                        <span className="text-secondary opacity-70">Streaming {showDebug}...</span>
                                    </div>
                                ) : (
                                    <>
                                        <pre className="whitespace-pre-wrap leading-relaxed">{showDebug === 'logs' ? logs : yamlContent}</pre>
                                        <div ref={logsEndRef} />
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t bg-app text-right rounded-b-lg">
                    <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-md font-semibold transition-colors">Close</button>
                </div>
            </div>
        </div>
    );
};

const SourceExplorer = ({ source, onClose, inventoryApiBase }) => {
    const [inventory, setInventory] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedVm, setSelectedVm] = useState(null);
    const [isOperating, setIsOperating] = useState(false);
    const isForklift = !!inventoryApiBase;

    const fetchInventory = useCallback(async (keepSelection = false) => {
        setIsLoading(true);
        setError('');
        try {
            const apiBase = inventoryApiBase || '/api/v1/vcenter/inventory';
            const response = await fetch(`${apiBase}/${source.metadata.namespace}/${source.metadata.name}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to fetch inventory");
            }
            const data = await response.json();
            setInventory(data);

            if (!keepSelection) {
                setSelectedVm(null);
            } else {
                setSelectedVm(current => {
                    if (!current) return null;
                    // Find and update selected VM in new data
                    const findVm = (node, name) => {
                        if (node.type === 'VirtualMachine' && node.name === name) return node;
                        if (node.children) {
                            for (const child of node.children) {
                                const found = findVm(child, name);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    const updated = findVm(data, current.name);
                    return updated || current;
                });
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [source, inventoryApiBase]); // Now stable regardless of selection

    const handlePowerOp = async (op) => {
        if (!selectedVm) return;
        setIsOperating(true);
        try {
            const response = await fetch(`/api/v1/vcenter/vm/${source.metadata.namespace}/${source.metadata.name}/power`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vmName: selectedVm.name, operation: op })
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Operation failed');
            }
            // Refresh inventory to see state change
            await fetchInventory(true);
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsOperating(false);
        }
    };

    const handleRename = async (oldName, newName) => {
        setIsOperating(true);
        try {
            const response = await fetch(`/api/v1/vcenter/vm/${source.metadata.namespace}/${source.metadata.name}/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldName, newName })
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Rename failed');
            }
            // Update local selection to new name before refresh
            setSelectedVm(prev => ({ ...prev, name: newName }));
            await fetchInventory(true);
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            setIsOperating(false);
        }
    };

    const handleMacUpdate = async (vmName, networkKey, newMac) => {
        setIsOperating(true); // Use isOperating for any VM-level operation
        try {
            const response = await fetch(`/api/v1/vcenter/vm/${source.metadata.namespace}/${source.metadata.name}/mac`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vmName, deviceKey: networkKey, newMac })
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'MAC update failed');
            }
            await fetchInventory(true); // Refresh inventory to show updated MAC
        } finally {
            setIsOperating(false);
        }
    };

    useEffect(() => {
        fetchInventory();
    }, [source, fetchInventory]);

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-5xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b">
                    <div className="flex items-center space-x-4">
                        <h2 className="text-xl font-semibold text-main">Explore: {source.metadata.name}</h2>
                        <button onClick={() => fetchInventory(true)} className="text-blue-500 hover:text-blue-700 p-1 rounded-full hover:bg-app transition-colors" title="Refresh Inventory">
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 flex-grow overflow-hidden flex flex-col">
                    {isLoading && !inventory ? (
                        <div className="flex flex-col items-center justify-center flex-grow">
                            <Loader className="animate-spin text-blue-500 mb-2" size={32} />
                            <p className="text-secondary">Loading vCenter inventory...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center flex-grow text-center">
                            <AlertTriangle className="text-red-500 mb-2" size={32} />
                            <p className="text-red-600 font-medium">Error loading inventory</p>
                            <p className="text-secondary text-sm mt-1">{error}</p>
                            <button onClick={fetchInventory} className="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md">Retry</button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full overflow-hidden">
                            <div className="border border-main rounded-md p-2 flex flex-col overflow-hidden bg-card shadow-sm font-sans">
                                {inventory && <FilterableInventoryTree node={inventory} onVmSelect={setSelectedVm} currentlySelectedVm={selectedVm} />}
                            </div>
                            <div className="overflow-y-auto">
                                <VmDetailsPanel
                                    vm={selectedVm}
                                    onPowerOp={isForklift ? null : handlePowerOp}
                                    onRename={isForklift ? null : handleRename}
                                    onMacUpdate={isForklift ? null : handleMacUpdate}
                                    isOperating={isOperating}
                                />
                            </div>
                        </div>
                    )}
                </div>
                <div className="p-4 border-t bg-app flex justify-between items-center rounded-b-lg">
                    <p className="text-xs text-secondary">Browsing data from {source.spec?.endpoint || source.spec?.url || source.metadata.name}</p>
                    <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-md font-semibold transition-colors shadow-sm transition-all active:scale-95">Close Explorer</button>
                </div>
            </div>
        </div>
    );
};

const VmIcon = ({ type }) => {
    switch (type) {
        case 'datacenter': return <Cloud className="w-5 h-5 text-blue-500" />;
        case 'ClusterComputeResource': return <Server className="w-5 h-5 text-purple-500" />;
        case 'Folder': return <Folder className="w-5 h-5 text-yellow-600" />;
        case 'VirtualMachine': return <HardDrive className="w-5 h-5 text-secondary" />;
        case 'disk': return <HardDrive className="w-4 h-4 text-blue-400" />;
        default: return null;
    }
};

const filterInventory = (node, query) => {
    if (!query) return node;
    const lowerQuery = query.toLowerCase();

    if (node.type === 'VirtualMachine' || node.type === 'disk') {
        if (node.name.toLowerCase().includes(lowerQuery)) {
            return node;
        }
        return null;
    }

    if (node.children && node.children.length > 0) {
        const filteredChildren = node.children
            .map(child => filterInventory(child, query))
            .filter(child => child !== null);

        if (filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
        }
    }

    return null;
};

const FilterableInventoryTree = ({ node, onVmSelect, currentlySelectedVm }) => {
    const [searchQuery, setSearchQuery] = useState('');

    const filteredNode = useMemo(() => {
        return filterInventory(node, searchQuery);
    }, [node, searchQuery]);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="mb-2 shrink-0 flex items-center">
                {searchQuery && (
                    <button
                        onClick={() => setSearchQuery('')}
                        className="mr-2 p-1 text-secondary opacity-70 hover:text-secondary hover:bg-app rounded-full transition-colors focus:outline-none"
                        title="Clear search"
                    >
                        <X size={14} />
                    </button>
                )}
                <div className="relative flex-grow">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <Search size={14} className="text-secondary opacity-70" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search VMs..."
                        className="w-full pl-8 pr-2 py-1.5 text-sm border border-main rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>
            <div className="flex-grow overflow-y-auto">
                {filteredNode ? (
                    <InventoryTree
                        node={filteredNode}
                        onVmSelect={onVmSelect}
                        currentlySelectedVm={currentlySelectedVm}
                        forceOpen={!!searchQuery}
                    />
                ) : (
                    <div className="text-center text-secondary text-sm py-8">No matching VMs found.</div>
                )}
            </div>
        </div>
    );
};

const InventoryTree = ({ node, onVmSelect, currentlySelectedVm, level = 0, forceOpen = false }) => {
    const [isOpen, setIsOpen] = useState(level < 2 || forceOpen);
    const isParent = node.children && node.children.length > 0;

    useEffect(() => {
        if (forceOpen) setIsOpen(true);
    }, [forceOpen]);

    const handleNodeClick = () => {
        if (node.type === 'VirtualMachine' || node.type === 'disk') {
            onVmSelect(node);
        }
        if (isParent) {
            setIsOpen(!isOpen);
        }
    };

    return (
        <div style={{ paddingLeft: level > 0 ? '20px' : '0px' }}>
            <div
                className={`flex items-center p-2 rounded-md cursor-pointer ${currentlySelectedVm?.name === node.name ? 'bg-blue-100' : 'hover:bg-app'}`}
                onClick={handleNodeClick}
            >
                {isParent && <ChevronRight size={16} className={`mr-1 transform transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                <VmIcon type={node.type} />
                <span className="ml-2 text-main">{node.name}</span>
            </div>
            {isOpen && isParent && (
                <div>
                    {node.children.map((child, index) => (
                        <InventoryTree
                            key={index}
                            node={child}
                            onVmSelect={onVmSelect}
                            currentlySelectedVm={currentlySelectedVm}
                            level={level + 1}
                            forceOpen={forceOpen}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const VmDetailsPanel = ({ vm, onPowerOp, onRename, isOperating, onMacUpdate }) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const [newName, setNewName] = useState('');
    const [editingMacKey, setEditingMacKey] = useState(null);
    const [newMac, setNewMac] = useState('');
    const [isUpdatingMac, setIsUpdatingMac] = useState(false);

    useEffect(() => {
        if (vm) {
            setNewName(vm.name);
            setIsRenaming(false);
        }
    }, [vm]);

    if (!vm) {
        return (
            <div className="border border-main rounded-md p-6 bg-app flex flex-col items-center justify-center text-secondary opacity-70 h-96">
                <Search size={48} className="mb-4 opacity-20" />
                <p className="text-sm font-medium">Select an item from the tree to view details</p>
            </div>
        );
    }

    const handleRenameSubmit = () => {
        if (newName && newName !== vm.name) {
            onRename(vm.name, newName);
        }
        setIsRenaming(false);
    };

    const isVm = vm.type === 'VirtualMachine';
    const isDisk = vm.type === 'disk';

    const getPowerStateColor = (state) => {
        switch (state) {
            case 'poweredOn': return 'text-green-600';
            case 'poweredOff': return 'text-red-600';
            case 'suspended': return 'text-yellow-600';
            default: return 'text-secondary';
        }
    };

    return (
        <div className="p-4 border rounded-md bg-app h-full flex flex-col">
            <div className="flex justify-between items-center mb-4">
                {isRenaming ? (
                    <div className="flex items-center space-x-2 w-full">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="form-input text-lg font-medium flex-grow"
                            autoFocus
                        />
                        <button onClick={handleRenameSubmit} className="text-green-600 hover:text-green-800"><CheckCircle size={20} /></button>
                        <button onClick={() => setIsRenaming(false)} className="text-red-600 hover:text-red-800"><X size={20} /></button>
                    </div>
                ) : (
                    <div className="flex items-center justify-between w-full">
                        <h3 className="text-lg font-medium text-main truncate" title={vm.name}>{vm.name}</h3>
                        <button onClick={() => setIsRenaming(true)} className="ml-2 text-secondary opacity-70 hover:text-blue-600 transition-colors" title="Rename VM">
                            <Edit size={16} />
                        </button>
                    </div>
                )}
            </div>

            <div className="space-y-3 text-sm flex-grow">
                {isVm && (
                    <>
                        <div className="flex items-center justify-between p-2 bg-card rounded border">
                            <span className="text-secondary font-medium">Power State:</span>
                            <span className={`font-bold ${getPowerStateColor(vm.powerState)}`}>{vm.powerState}</span>
                        </div>

                        <div className="flex items-center">
                            <Cpu size={16} className="mr-2 text-secondary" />
                            <span>{vm.cpu || '0'} vCPU(s)</span>
                        </div>
                        <div className="flex items-center">
                            <MemoryStick size={16} className="mr-2 text-secondary" />
                            <span>{formatBytes((vm.memoryMB || 0) * 1024 * 1024, 0)} Memory</span>
                        </div>
                        <div className="flex items-center">
                            <HardDrive size={16} className="mr-2 text-secondary" />
                            <span>{vm.diskSizeGB || '0'} GB Storage (Committed)</span>
                        </div>
                        <div className="flex items-center">
                            <Folder size={16} className="mr-2 text-secondary" />
                            <span className="truncate" title={vm.folder || '/'}>{vm.folder || '/'}</span>
                        </div>
                        <div>
                            <h4 className="font-medium text-main mt-4 mb-1 border-b pb-1">Networks</h4>
                            <div className="space-y-2 mt-2">
                                {(vm.networks || []).map((net, i) => (
                                    <div key={i} className="flex flex-col p-2 bg-card rounded border shadow-sm">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center space-x-2 truncate">
                                                <Network size={14} className="text-blue-500 shrink-0" />
                                                <span className="text-main truncate font-medium">{net.name || net}</span>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                {editingMacKey === net.key ? (
                                                    <div className="flex items-center space-x-1">
                                                        <input
                                                            type="text"
                                                            value={newMac}
                                                            onChange={(e) => setNewMac(e.target.value)}
                                                            className="text-[10px] font-mono border rounded px-1 w-32 py-0.5"
                                                            autoFocus
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                setIsUpdatingMac(true);
                                                                onMacUpdate(vm.name, net.key, newMac)
                                                                    .then(() => setEditingMacKey(null))
                                                                    .catch(err => alert(err.message))
                                                                    .finally(() => setIsUpdatingMac(false));
                                                            }}
                                                            disabled={isUpdatingMac}
                                                            className="text-green-600 hover:text-green-700"
                                                        >
                                                            <Check size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingMacKey(null)}
                                                            className="text-red-600 hover:text-red-700"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center space-x-1 group/mac">
                                                        <span className="text-[10px] font-mono text-secondary">{net.mac || 'No MAC'}</span>
                                                        {net.mac && (
                                                            <button
                                                                onClick={() => {
                                                                    setEditingMacKey(net.key);
                                                                    setNewMac(net.mac);
                                                                }}
                                                                className="text-secondary opacity-70 hover:text-blue-600 p-0.5 opacity-0 group-hover/mac:opacity-100 transition-opacity"
                                                                title="Edit MAC Address"
                                                            >
                                                                <Edit size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {(!vm.networks || vm.networks.length === 0) && <p className="text-xs text-secondary opacity-70 italic">No network interfaces.</p>}
                            </div>
                        </div>
                        <div>
                            <h4 className="font-medium text-main mt-4 mb-1 border-b pb-1">Individual Disks</h4>
                            <div className="space-y-2 mt-2">
                                {(vm.disks || []).map((disk, i) => (
                                    <div key={i} className="flex flex-col p-2 bg-card rounded border shadow-sm">
                                        <div className="flex justify-between items-center bg-app -m-2 mb-2 px-2 py-1 rounded-t border-b overflow-hidden">
                                            <span className="font-bold text-main truncate text-[10px]">{disk.name}</span>
                                            <span className="text-[10px] font-mono text-blue-600">{disk.busType}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-secondary">{formatBytes(disk.capacity)}</span>
                                            <span className="text-secondary opacity-70">Unit: {disk.unitNum}</span>
                                        </div>
                                    </div>
                                ))}
                                {(!vm.disks || vm.disks.length === 0) && <p className="text-xs text-secondary opacity-70 italic">No detailed disk info available.</p>}
                            </div>
                        </div>
                    </>
                )}
                {isDisk && (
                    <div className="p-4 bg-card rounded-lg border shadow-sm space-y-4">
                        <div className="flex items-center space-x-3 text-blue-600">
                            <HardDrive size={24} />
                            <h4 className="text-lg font-semibold">Disk Selection</h4>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-secondary font-medium">Node:</span>
                                <span className="text-main font-bold">{vm.name}</span>
                            </div>
                            <p className="text-xs text-secondary italic">This is a virtual disk component of the parent VM. Select the VM node itself to perform power operations.</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-6 pt-4 border-t">
                <h4 className="text-sm font-semibold text-main mb-3 uppercase tracking-wider">VM Operations</h4>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => onPowerOp('on')}
                        disabled={isOperating || vm.powerState === 'poweredOn'}
                        className="flex items-center justify-center px-3 py-2 bg-card border border-green-200 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50 disabled:bg-app transition-colors"
                        title="Power On"
                    >
                        <Play size={16} className="mr-2" /> Power On
                    </button>
                    <button
                        onClick={() => onPowerOp('shutdown')}
                        disabled={isOperating || vm.powerState === 'poweredOff'}
                        className="flex items-center justify-center px-3 py-2 bg-card border border-red-200 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:bg-app transition-colors"
                        title="Guest Shutdown"
                    >
                        <Power size={16} className="mr-2" /> Shutdown
                    </button>
                    <button
                        onClick={() => onPowerOp('off')}
                        disabled={isOperating || vm.powerState === 'poweredOff'}
                        className="flex items-center justify-center px-3 py-2 bg-card border border-red-200 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:bg-app transition-colors"
                        title="Power Off (Immediate)"
                    >
                        <Square size={16} className="mr-2 text-red-600" /> Power Off
                    </button>
                    <button
                        onClick={() => onPowerOp('reset')}
                        disabled={isOperating || vm.powerState === 'poweredOff'}
                        className="flex items-center justify-center px-3 py-2 bg-card border border-yellow-200 text-yellow-700 rounded-md hover:bg-yellow-50 disabled:opacity-50 disabled:bg-app transition-colors"
                        title="Reset"
                    >
                        <RotateCcw size={16} className="mr-2" /> Reset
                    </button>
                </div>
                {isOperating && (
                    <div className="mt-3 flex items-center justify-center text-xs text-blue-600 animate-pulse">
                        <Loader size={12} className="animate-spin mr-1" /> Executing operation...
                    </div>
                )}
            </div>
        </div>
    );
};

// --- UPDATED WIZARD COMPONENT ---
const CreatePlanWizard = ({ onCancel, onCreatePlan, capabilities, forkliftAvailable, forkliftNamespace }) => {
    const [step, setStep] = useState(1);
    const [engine, setEngine] = useState('vmic'); // 'vmic' or 'forklift'
    const [sourceType, setSourceType] = useState('vmware');
    const [vmwareSources, setVmwareSources] = useState([]);
    const [ovaSources, setOvaSources] = useState([]);
    const [selectedSource, setSelectedSource] = useState("");
    const [vcenterInventory, setVcenterInventory] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState('');
    const [selectedVm, setSelectedVm] = useState(null);
    const [planName, setPlanName] = useState('');
    const [targetNamespace, setTargetNamespace] = useState('');
    const [newNamespace, setNewNamespace] = useState('');
    const [namespaces, setNamespaces] = useState([]);
    const [existingVmNames, setExistingVmNames] = useState([]);
    const [vmNameConflict, setVmNameConflict] = useState(false);
    const [ovaVmName, setOvaVmName] = useState('');

    // Updated state for mappings
    const [networkMappings, setNetworkMappings] = useState({});
    const [networkModels, setNetworkModels] = useState({});

    const [harvesterNetworks, setHarvesterNetworks] = useState([]);
    const [storageClass, setStorageClass] = useState('');
    const [storageClasses, setStorageClasses] = useState([]);

    // New state for advanced options
    const [forcePowerOff, setForcePowerOff] = useState(false);
    const [shutdownTimeout, setShutdownTimeout] = useState('');
    const [defaultModel, setDefaultModel] = useState('');

    // NEW: States for v1.6 features
    const [skipPreflight, setSkipPreflight] = useState(false);
    const [diskBus, setDiskBus] = useState('');

    // Forklift-specific state
    const [forkliftProviders, setForkliftProviders] = useState([]);
    const [forkliftTargetName, setForkliftTargetName] = useState('');
    const [migrateSharedDisks, setMigrateSharedDisks] = useState(true);
    const [populatorLabels, setPopulatorLabels] = useState(true);
    const [warmMigration, setWarmMigration] = useState(false);
    const [forkliftStorageMappings, setForkliftStorageMappings] = useState({});
    const [forkliftVolumeModes, setForkliftVolumeModes] = useState({});
    const [forkliftAccessModes, setForkliftAccessModes] = useState({});
    const [selectedProviderType, setSelectedProviderType] = useState('vsphere'); // 'vsphere' or 'ova'
    const [ovaInventory, setOvaInventory] = useState(null); // OVA provider inventory (flat VM list)

    const fetchNamespaces = () => {
        fetch('/api/v1/harvester/namespaces')
            .then(res => res.json())
            .then(data => setNamespaces(data.map(ns => ns.metadata.name)))
            .catch(err => console.error("Failed to fetch namespaces:", err));
    };

    const fetchSources = () => {
        fetch('/api/v1/harvester/vmwaresources')
            .then(res => res.json())
            .then(data => setVmwareSources(data || []))
            .catch(err => console.error("Failed to fetch VmwareSources:", err));
    };

    const fetchOvaSources = () => {
        fetch('/api/v1/harvester/ovasources')
            .then(res => res.json())
            .then(data => setOvaSources(data || []))
            .catch(err => console.error("Failed to fetch OvaSources:", err));
    };

    const fetchForkliftProvidersList = () => {
        fetch('/api/v1/forklift/providers')
            .then(res => res.json())
            .then(data => setForkliftProviders(data || []))
            .catch(err => console.error("Failed to fetch Forklift Providers:", err));
    };

    const fetchNetworks = () => {
        fetch('/api/v1/harvester/vlanconfigs')
            .then(res => res.json())
            .then(data => {
                console.log("Raw VLAN data from API:", JSON.stringify(data, null, 2));
                if (!Array.isArray(data)) {
                    console.warn("VLAN data is not an array:", data);
                    setHarvesterNetworks([]);
                    return;
                }
                const networks = data.map(net => {
                    const ns = net?.metadata?.namespace || 'default';
                    const name = net?.metadata?.name || 'unknown';
                    return ns + "/" + name;
                }).filter(Boolean);
                console.log("Parsed Harvester networks:", networks);
                setHarvesterNetworks(networks);
            })
            .catch(err => {
                console.error("Failed to fetch networks:", err);
                setHarvesterNetworks([]);
            });
    };

    const fetchStorageClasses = () => {
        fetch('/api/v1/harvester/storageclasses').then(res => res.json()).then(data => setStorageClasses(data.map(sc => sc.metadata.name)));
    };

    const fetchVmsInNamespace = async (namespace) => {
        if (!namespace) {
            setExistingVmNames([]);
            return;
        }
        try {
            const response = await fetch(`/api/v1/harvester/virtualmachines/${namespace}`);
            const data = await response.json();
            setExistingVmNames(data.map(vm => vm.metadata.name));
        } catch (err) {
            console.error("Failed to fetch VMs in namespace:", err);
        }
    };

    useEffect(() => {
        fetchSources();
        fetchOvaSources();
        fetchNamespaces();
        fetchNetworks();
        fetchStorageClasses();
        if (forkliftAvailable) fetchForkliftProvidersList();
    }, [forkliftAvailable]);

    useEffect(() => {
        fetchVmsInNamespace(targetNamespace);
    }, [targetNamespace]);

    useEffect(() => {
        const nameToCheck = sourceType === 'ova' ? ovaVmName : (selectedVm ? selectedVm.name : '');
        if (nameToCheck && existingVmNames.includes(nameToCheck)) {
            setVmNameConflict(true);
        } else {
            setVmNameConflict(false);
        }
    }, [selectedVm, ovaVmName, sourceType, existingVmNames]);

    // Auto-suggest RFC-1123 compliant target name for Forklift when VM name is non-compliant
    useEffect(() => {
        if (engine !== 'forklift' || !selectedVm?.name) {
            setForkliftTargetName('');
            return;
        }
        const rfcRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
        const vmName = selectedVm.name;
        if (rfcRegex.test(vmName) && vmName.length <= 63) {
            setForkliftTargetName('');
        } else {
            const slugified = slugify(vmName);
            setForkliftTargetName(slugified);
        }
    }, [selectedVm, engine]);

    const handleSourceChange = async (sourceIdentifier) => {
        setSelectedSource(sourceIdentifier);
        setSelectedVm(null);
        setOvaInventory(null);
        if (!sourceIdentifier) {
            setVcenterInventory(null);
            return;
        }

        if (sourceType === 'ova' && engine === 'vmic') {
            return;
        }

        const [namespace, name] = sourceIdentifier.split('/');

        // Detect OVA provider type from the provider list
        if (engine === 'forklift') {
            const provider = forkliftProviders.find(p => `${p.metadata.namespace}/${p.metadata.name}` === sourceIdentifier);
            const provType = provider?.spec?.type || 'vsphere';
            setSelectedProviderType(provType);

            if (provType === 'ova') {
                setIsConnecting(true);
                setConnectionError('');
                try {
                    const response = await fetch(`/api/v1/forklift/inventory/ova/${namespace}/${name}/vms`);
                    if (!response.ok) {
                        const errData = await response.json();
                        throw new Error(errData.error || "Failed to fetch OVA inventory");
                    }
                    const vms = await response.json();
                    setOvaInventory(vms || []);
                } catch (error) {
                    setConnectionError(error.message);
                } finally {
                    setIsConnecting(false);
                }
                return;
            }
        }

        setIsConnecting(true);
        setConnectionError('');
        try {
            // Use different API endpoint depending on the engine
            const apiUrl = engine === 'forklift'
                ? `/api/v1/forklift/inventory/${namespace}/${name}`
                : `/api/v1/vcenter/inventory/${namespace}/${name}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to fetch inventory");
            }
            const data = await response.json();
            setVcenterInventory(data);
        } catch (error) {
            setConnectionError(error.message);
        } finally {
            setIsConnecting(false);
        }
    };

    const sourceNetworks = useMemo(() => {
        if (!selectedVm) return [];
        const networks = selectedVm.networks || [];
        if (engine === 'forklift') {
            // For Forklift, use network ID as key (required for NetworkMap sourceId)
            const seen = new Set();
            return networks.filter(n => {
                const id = n.id || n.name || 'unknown';
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            }).map(n => ({
                key: n.id || n.name,
                displayName: n.name || n.Name || 'Unknown Network',
                id: n.id || n.name
            }));
        }
        // For VMIC, use network name as key (existing behavior)
        return [...new Set(networks.map(n => n.name || n.Name || 'Unknown Network'))].map(name => ({
            key: name,
            displayName: name
        }));
    }, [selectedVm, engine]);

    // Extract unique datastores from the selected VM for Forklift storage mapping
    // For OVA providers, each disk is a separate storage mapping entry
    const sourceDatastores = useMemo(() => {
        if (!selectedVm || engine !== 'forklift') return [];

        if (selectedProviderType === 'ova') {
            // OVA: per-disk model — each VMDK file is a separate mapping entry
            const disks = selectedVm.disks || [];
            return disks.map((disk, idx) => ({
                id: disk.id || `disk-${idx}`,
                name: disk.name || disk.filePath || `Disk ${idx + 1}`,
                isOvaDisk: true,
            }));
        }

        // vSphere: per-datastore model
        const datastores = [];
        const seen = new Set();
        if (selectedVm.datastoreId) {
            seen.add(selectedVm.datastoreId);
            datastores.push({
                id: selectedVm.datastoreId,
                name: selectedVm.datastoreName || selectedVm.datastoreId,
            });
        }
        return datastores;
    }, [selectedVm, engine, selectedProviderType]);

    const handleCreateNamespace = async () => {
        if (!newNamespace) {
            alert("New namespace name cannot be empty.");
            return false;
        }
        try {
            const response = await fetch('/api/v1/harvester/namespaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newNamespace }),
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(`Failed to create namespace: ${err.error}`);
            }
            fetchNamespaces();
            setTargetNamespace(newNamespace);
            setNewNamespace('');
            return true;
        } catch (error) {
            console.error(error);
            alert(error.message);
            return false;
        }
    };

    const handleSubmit = async () => {
        let finalTargetNamespace = targetNamespace;
        if (targetNamespace === 'create_new') {
            const success = await handleCreateNamespace();
            if (!success) return;
            finalTargetNamespace = newNamespace;
        }

        if (!finalTargetNamespace) {
            alert("Please select a target namespace before creating the plan.");
            return;
        }

        const [sourceNamespace, sourceName] = selectedSource.split('/');

        // --- Forklift Plan Creation ---
        if (engine === 'forklift') {
            // Validate target VM name is RFC-1123 compliant
            const rfcRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
            const vmName = selectedVm?.name || '';
            const effectiveTargetName = forkliftTargetName || vmName;
            if (!rfcRegex.test(effectiveTargetName) || effectiveTargetName.length > 63) {
                alert("The target VM name is not RFC-1123 compliant. Please provide a valid target name (lowercase alphanumeric and hyphens, max 63 characters).");
                return;
            }

            // Use the deduplicated sourceNetworks memo for network mappings
            const networkMappingsForklift = sourceNetworks.map(net => {
                const dest = networkMappings[net.key] || '';
                // Harvester networks come as "namespace/name" — split for Forklift's separate fields
                const destParts = dest ? dest.split('/') : [];
                const destNamespace = destParts.length > 1 ? destParts[0] : '';
                const destName = destParts.length > 1 ? destParts.slice(1).join('/') : dest;
                return {
                    sourceId: net.id || net.key,
                    sourceName: net.displayName,
                    destinationType: dest ? 'multus' : 'pod',
                    destinationName: destName,
                    destinationNamespace: destNamespace,
                };
            });

            // Build storage mappings from the per-datastore/per-disk selections
            const storageMappingsForklift = sourceDatastores.map(ds => {
                const entry = {
                    destinationStorageClass: forkliftStorageMappings[ds.id] || storageClass,
                    volumeMode: forkliftVolumeModes[ds.id] || undefined,
                    accessMode: forkliftAccessModes[ds.id] || undefined,
                };
                // OVA uses source.name (disk filename), vSphere uses source.id (moRef)
                if (ds.isOvaDisk) {
                    entry.sourceName = ds.name;
                    entry.sourceId = ds.id;
                } else {
                    entry.sourceId = ds.id;
                }
                return entry;
            }).filter(sm => sm.destinationStorageClass); // Only include if a storage class is selected

            const forkliftPayload = {
                name: slugify(planName),
                namespace: sourceNamespace,
                providerName: sourceName,
                providerNamespace: sourceNamespace,
                providerType: selectedProviderType,
                hostProviderNamespace: forkliftNamespace || 'forklift',
                targetNamespace: finalTargetNamespace,
                networkMappings: networkMappingsForklift,
                storageMappings: storageMappingsForklift,
                vms: [{ id: selectedVm?.id, name: selectedVm?.name, targetName: forkliftTargetName || undefined }],
                migrateSharedDisks: migrateSharedDisks,
                populatorLabels: populatorLabels,
                warm: selectedProviderType === 'ova' ? false : warmMigration,
                defaultNetworkInterfaceModel: defaultModel || undefined,
                sourceVmCpu: selectedVm?.cpu || 0,
                sourceVmMemoryMB: selectedVm?.memoryMB || 0,
                sourceVmDiskSizeGB: selectedVm?.diskSizeGB || 0,
                sourceVmDisks: JSON.stringify(selectedVm?.disks || []),
                sourceVmNetworks: JSON.stringify(selectedVm?.networks || []),
            };

            try {
                const response = await fetch('/api/v1/forklift/plans', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(forkliftPayload),
                });
                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error || "Failed to create Forklift plan");
                }
                onCancel(); // Return to plans list
            } catch (err) {
                console.error("Failed to create Forklift plan:", err);
                alert(`Error creating Forklift plan: ${err.message}`);
            }
            return;
        }

        // --- VM Import Controller Plan Creation ---
        const originalVmName = slugify(sourceType === 'ova' ? ovaVmName : selectedVm?.name || '');
        const folder = (sourceType !== 'ova' && selectedVm?.folder && selectedVm.folder !== '/') ? selectedVm.folder : undefined;

        // Construct the plan object
        const plan = {
            apiVersion: "migration.harvesterhci.io/v1beta1",
            kind: "VirtualMachineImport",
            metadata: {
                name: slugify(planName),
                namespace: finalTargetNamespace,
                annotations: sourceType === 'vmware' && selectedVm ? {
                    'migration.harvesterhci.io/original-cpu': selectedVm.cpu?.toString() || '0',
                    'migration.harvesterhci.io/original-memory-mb': selectedVm.memoryMB?.toString() || '0',
                    'migration.harvesterhci.io/original-disk-size-gb': selectedVm.diskSizeGB?.toString() || '0',
                    'migration.harvesterhci.io/original-disks': JSON.stringify(selectedVm.disks || []),
                    'migration.harvesterhci.io/original-networks': JSON.stringify(selectedVm.networks || []),
                } : undefined
            },
            spec: {
                virtualMachineName: originalVmName,
                sourceCluster: {
                    name: sourceName,
                    namespace: sourceNamespace,
                    kind: sourceType === 'ova' ? "OvaSource" : "VmwareSource",
                    apiVersion: "migration.harvesterhci.io/v1beta1",
                },
                storageClass: storageClass,
                networkMapping: Object.entries(networkMappings).map(([key, value]) => ({
                    sourceNetwork: key,
                    destinationNetwork: `${value}`,
                    networkInterfaceModel: capabilities.hasAdvancedPower ? (networkModels[key] || undefined) : undefined
                })),
                folder: folder,
            }
        };

        // Only attach advanced fields if the cluster supports them
        if (capabilities.hasAdvancedPower) {
            plan.spec.forcePowerOff = forcePowerOff;
            if (shutdownTimeout) {
                plan.spec.gracefulShutdownTimeoutSeconds = parseInt(shutdownTimeout);
            }
            if (defaultModel) {
                plan.spec.defaultNetworkInterfaceModel = defaultModel;
            }

            // NEW: Attach v1.6 fields
            plan.spec.skipPreflightChecks = skipPreflight;
            if (diskBus) {
                plan.spec.defaultDiskBusType = diskBus;
            }
        }

        onCreatePlan(plan);
    };

    const renderStepContent = () => {
        switch (step) {
            case 1:
                return (
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium text-main mb-2">Select Source & VM</h3>

                        <div>
                            <label className="block text-sm font-medium text-main mb-1">Migration Engine</label>
                            <div className="flex items-center space-x-6">
                                <label className="inline-flex items-center">
                                    <input type="radio" className="form-radio text-blue-600" name="engine" value="vmic" checked={engine === 'vmic'} onChange={() => { setEngine('vmic'); setSelectedSource(''); setSelectedVm(null); setVcenterInventory(null); setOvaInventory(null); setSourceType('vmware'); setNetworkMappings({}); setForkliftStorageMappings({}); setForkliftVolumeModes({}); setForkliftAccessModes({}); setForkliftTargetName(''); setSelectedProviderType('vsphere'); }} />
                                    <span className="ml-2">VM Import Controller</span>
                                </label>
                                <label className={`inline-flex items-center ${!forkliftAvailable ? 'opacity-50' : ''}`}>
                                    <input type="radio" className="form-radio text-blue-600" name="engine" value="forklift" checked={engine === 'forklift'} disabled={!forkliftAvailable} onChange={() => { setEngine('forklift'); setSelectedSource(''); setSelectedVm(null); setVcenterInventory(null); setOvaInventory(null); setSourceType('vmware'); setNetworkMappings({}); setForkliftStorageMappings({}); setForkliftVolumeModes({}); setForkliftAccessModes({}); setForkliftTargetName(''); setSelectedProviderType('vsphere'); }} />
                                    <span className="ml-2">Forklift{!forkliftAvailable ? ' (unavailable)' : ''}</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-main">Plan Name</label>
                            <input type="text" value={planName} onChange={e => setPlanName(e.target.value)} className="mt-1 block w-full form-input" />
                        </div>

                        {engine === 'vmic' && (
                            <div className="mb-4 flex items-center space-x-6">
                                <label className="inline-flex items-center">
                                    <input type="radio" className="form-radio text-blue-600" name="sourceType" value="vmware" checked={sourceType === 'vmware'} onChange={() => { setSourceType('vmware'); setSelectedSource(''); setSelectedVm(null); setForkliftTargetName(''); }} />
                                    <span className="ml-2">VMware vCenter</span>
                                </label>
                                <label className="inline-flex items-center">
                                    <input type="radio" className="form-radio text-blue-600" name="sourceType" value="ova" checked={sourceType === 'ova'} onChange={() => { setSourceType('ova'); setSelectedSource(''); setOvaVmName(''); }} />
                                    <span className="ml-2">OVA File</span>
                                </label>
                            </div>
                        )}

                        {engine === 'forklift' ? (
                            <div className="space-y-4 p-4 border rounded-md bg-app">
                                <div className="flex items-center">
                                    <label className="block text-sm font-medium text-main flex-grow">Forklift Source Provider</label>
                                    <button onClick={fetchForkliftProvidersList} className="ml-2 text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                                </div>
                                <select value={selectedSource} onChange={e => handleSourceChange(e.target.value)} className="mt-1 block w-full form-select">
                                    <option value="">Select a provider...</option>
                                    {forkliftProviders.map(provider => (
                                        <option key={provider.metadata.uid} value={`${provider.metadata.namespace}/${provider.metadata.name}`}>
                                            [{provider.spec?.type === 'ova' ? 'OVA' : provider.spec?.settings?.sdkEndpoint === 'esxi' ? 'ESXi' : 'vCenter'}] {provider.metadata.namespace}/{provider.metadata.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : sourceType === 'vmware' ? (
                            <div className="space-y-4 p-4 border rounded-md bg-app">
                                <div className="flex items-center">
                                    <label className="block text-sm font-medium text-main flex-grow">vCenter Source</label>
                                    <button onClick={fetchSources} className="ml-2 text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                                </div>
                                <select value={selectedSource} onChange={e => handleSourceChange(e.target.value)} className="mt-1 block w-full form-select">
                                    <option value="">Select a source...</option>
                                    {vmwareSources.map(source => (
                                        <option key={source.metadata.uid} value={`${source.metadata.namespace}/${source.metadata.name}`}>
                                            {source.metadata.namespace}/{source.metadata.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="space-y-4 p-4 border rounded-md bg-app">
                                <div className="flex items-center">
                                    <label className="block text-sm font-medium text-main flex-grow">OVA Source</label>
                                    <button onClick={fetchOvaSources} className="ml-2 text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                                </div>
                                <select value={selectedSource} onChange={e => handleSourceChange(e.target.value)} className="mt-1 block w-full form-select">
                                    <option value="">Select an OVA source...</option>
                                    {ovaSources.map(source => (
                                        <option key={source.metadata.uid} value={`${source.metadata.namespace}/${source.metadata.name}`}>
                                            {source.metadata.namespace}/{source.metadata.name}
                                        </option>
                                    ))}
                                </select>
                                <div>
                                    <label className="block text-sm font-medium text-main">Target VM Name</label>
                                    <input type="text" placeholder="e.g. My-Imported-OVA" value={ovaVmName} onChange={e => setOvaVmName(e.target.value)} className="mt-1 block w-full form-input" />
                                </div>
                            </div>
                        )}

                        {isConnecting && <Loader className="animate-spin mt-4" />}
                        {connectionError && <p className="text-sm text-red-600 mt-2">{connectionError}</p>}

                        {/* OVA inventory: flat VM list */}
                        {engine === 'forklift' && selectedProviderType === 'ova' && ovaInventory && (
                            <div className="mt-4">
                                <div className="border border-main rounded-md bg-card overflow-hidden">
                                    <div className="flex items-center justify-between p-2 bg-app border-b">
                                        <span className="text-sm font-medium text-main">OVA Virtual Machines ({ovaInventory.length})</span>
                                        <button onClick={() => handleSourceChange(selectedSource)} className="text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                                    </div>
                                    <div className="max-h-80 overflow-y-auto">
                                        {ovaInventory.length === 0 ? (
                                            <p className="p-4 text-sm text-secondary">No VMs found in OVA inventory. The OVA server pod may still be scanning the NFS share.</p>
                                        ) : (
                                            <table className="min-w-full divide-y divide-main">
                                                <thead className="bg-app">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-secondary uppercase">Name</th>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-secondary uppercase">CPU</th>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-secondary uppercase">Memory</th>
                                                        <th className="px-4 py-2 text-left text-xs font-medium text-secondary uppercase">Disks</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-main">
                                                    {ovaInventory.map(vm => (
                                                        <tr
                                                            key={vm.id}
                                                            className={`cursor-pointer hover:bg-blue-50 ${selectedVm?.id === vm.id ? 'bg-blue-100 border-l-4 border-blue-500' : ''}`}
                                                            onClick={() => setSelectedVm(vm)}
                                                        >
                                                            <td className="px-4 py-2 text-sm text-main font-medium">{vm.name}</td>
                                                            <td className="px-4 py-2 text-sm text-secondary">{vm.cpuCount || vm.cpu || '-'}</td>
                                                            <td className="px-4 py-2 text-sm text-secondary">{vm.memoryMB ? `${vm.memoryMB} MB` : '-'}</td>
                                                            <td className="px-4 py-2 text-sm text-secondary">{vm.disks?.length || 0} disk(s)</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                                {selectedVm && <VmDetailsPanel vm={selectedVm} />}
                            </div>
                        )}

                        {sourceType === 'vmware' && !(engine === 'forklift' && selectedProviderType === 'ova') && vcenterInventory && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                <div className="border border-main rounded-md p-2 h-96 flex flex-col overflow-hidden bg-card">
                                    <div className="flex justify-end shrink-0 mb-1">
                                        <button onClick={() => handleSourceChange(selectedSource)} className="text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                                    </div>
                                    <div className="flex-grow overflow-hidden">
                                        <FilterableInventoryTree node={vcenterInventory} onVmSelect={setSelectedVm} currentlySelectedVm={selectedVm} />
                                    </div>
                                </div>
                                <VmDetailsPanel vm={selectedVm} />
                            </div>
                        )}
                        {engine === 'forklift' && selectedVm && (() => {
                            const rfcRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
                            const vmName = selectedVm.name || '';
                            const slugified = slugify(vmName);
                            const isCompliant = rfcRegex.test(vmName) && vmName.length <= 63;
                            if (isCompliant) return null;
                            return (
                                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-300 rounded-md">
                                    <div className="flex items-start">
                                        <AlertTriangle className="text-yellow-500 w-5 h-5 mr-2 mt-0.5 shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-yellow-800">VM name "{vmName}" is not RFC-1123 compliant</p>
                                            <p className="text-xs text-yellow-700 mt-1">Kubernetes requires names to be lowercase alphanumeric with hyphens, max 63 characters. Please provide a valid target name for the destination VM.</p>
                                            <div className="mt-2">
                                                <label className="block text-xs font-medium text-yellow-800 mb-1">Target VM Name</label>
                                                <input
                                                    type="text"
                                                    value={forkliftTargetName}
                                                    onChange={e => setForkliftTargetName(e.target.value)}
                                                    placeholder="Enter RFC-1123 compliant name"
                                                    className="block w-full form-input text-sm"
                                                />
                                                {forkliftTargetName && !rfcRegex.test(forkliftTargetName) && (
                                                    <p className="text-xs text-red-600 mt-1">Target name is still not RFC-1123 compliant.</p>
                                                )}
                                                {forkliftTargetName && forkliftTargetName.length > 63 && (
                                                    <p className="text-xs text-red-600 mt-1">Target name must be 63 characters or less.</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                        <p className="text-sm text-secondary mt-2">
                            {sourceType === 'ova' ? (ovaVmName && selectedSource ? '1 VM configured for import.' : 'Select source and enter VM name.') : (selectedVm ? '1 VM selected for migration.' : '0 VMs selected.')}
                        </p>
                    </div>
                );
            case 2:
                return (
                    <div>
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-medium text-main mb-2">Configuration</h3>
                            <button onClick={() => { fetchNamespaces(); fetchStorageClasses(); }} className="text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                        </div>
                        <p className="text-sm text-secondary mb-4">Define the migration plan details and target resources.</p>

                        {/* WARNING BANNER if capabilities are missing */}
                        {(!capabilities.hasAdvancedPower && capabilities.harvesterVersion) && (
                            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md flex items-start">
                                <AlertTriangle className="text-yellow-500 w-5 h-5 mr-2 mt-0.5" />
                                <div>
                                    <h4 className="text-sm font-semibold text-yellow-800">Compatibility Mode</h4>
                                    <p className="text-sm text-yellow-700 mt-1">
                                        You are connected to Harvester <strong>{capabilities.harvesterVersion}</strong>.
                                        Advanced options (Force Power Off, Interface Models, Disk Bus) require Harvester v1.6.0+ and have been hidden.
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-main">Target Namespace</label>
                                <select value={targetNamespace} onChange={e => setTargetNamespace(e.target.value)} className="mt-1 block w-full form-select" size={Math.min(namespaces.length + 2, 10)}>
                                    <option value="">Select a namespace</option>
                                    <option value="create_new">--- Create New Namespace ---</option>
                                    {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                                </select>
                                {targetNamespace === 'create_new' && (
                                    <input
                                        type="text"
                                        value={newNamespace}
                                        onChange={e => setNewNamespace(e.target.value)}
                                        placeholder="Enter new namespace name"
                                        className="mt-2 block w-full form-input"
                                    />
                                )}
                                {vmNameConflict && <p className="text-sm text-red-600 mt-1">A VM with the name "{selectedVm.name}" already exists in this namespace. Please choose a different namespace.</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-main">Target Storage Class</label>
                                <select value={storageClass} onChange={e => setStorageClass(e.target.value)} className="mt-1 block w-full form-select">
                                    <option value="">Select a Storage Class</option>
                                    {storageClasses.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Forklift-specific options */}
                        {engine === 'forklift' && (
                            <div className="mt-6 border-t pt-4">
                                <h4 className="text-md font-medium text-main mb-3">Forklift Options</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-app p-4 rounded-md border">
                                    <div className="flex items-center" title={"When enabled, disks that are shared between multiple VMs (e.g. shared VMDK, multi-writer) will be included in the migration.\n\nIf disabled, shared disks are skipped and only exclusive disks are migrated. Enable this if the VM depends on shared storage that must be preserved."}>
                                        <input
                                            id="migrateSharedDisks"
                                            type="checkbox"
                                            checked={migrateSharedDisks}
                                            onChange={e => setMigrateSharedDisks(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-main rounded"
                                        />
                                        <label htmlFor="migrateSharedDisks" className="ml-2 block text-sm text-main cursor-help">
                                            Migrate Shared Disks
                                            <p className="text-xs text-secondary mt-0.5">Include disks shared between VMs.</p>
                                        </label>
                                    </div>
                                    <div className="flex items-center" title={"Uses the Kubernetes Volume Populator mechanism (CDI) for disk data transfer instead of the legacy importer approach.\n\nRecommended for Harvester/KubeVirt environments. Populator labels are added to PVCs so the CDI controller can track and manage the data import lifecycle."}>
                                        <input
                                            id="populatorLabels"
                                            type="checkbox"
                                            checked={populatorLabels}
                                            onChange={e => setPopulatorLabels(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-main rounded"
                                        />
                                        <label htmlFor="populatorLabels" className="ml-2 block text-sm text-main cursor-help">
                                            Populator Labels
                                            <p className="text-xs text-secondary mt-0.5">Use volume populator for data transfer.</p>
                                        </label>
                                    </div>
                                    <div className="flex items-center" title={selectedProviderType === 'ova' ? "Warm migration is not supported for OVA providers." : "Requires VMware Changed Block Tracking (CBT) enabled on the source VM.\n\n1. VM must have no snapshots, or CBT must be enabled before any snapshots are taken.\n2. Enable CBT: VM Settings → Options → Advanced → Configuration Parameters → add ctkEnabled = TRUE.\n3. The vSphere user must have permissions for QueryChangedDiskAreas.\n4. VDDK (Virtual Disk Development Kit) must be available to the Forklift controller."}>
                                        <input
                                            id="warmMigration"
                                            type="checkbox"
                                            checked={selectedProviderType === 'ova' ? false : warmMigration}
                                            onChange={e => setWarmMigration(e.target.checked)}
                                            disabled={selectedProviderType === 'ova'}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-main rounded"
                                        />
                                        <label htmlFor="warmMigration" className={`ml-2 block text-sm text-main cursor-help ${selectedProviderType === 'ova' ? 'opacity-50' : ''}`}>
                                            Warm Migration
                                            <p className="text-xs text-secondary mt-0.5">
                                                {selectedProviderType === 'ova' ? 'Not supported for OVA providers.' : 'Pre-copy disks while VM is running, then do a final short cutover.'}
                                            </p>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Advanced Options Section (VM Import Controller only) */}
                        {engine !== 'forklift' && capabilities.hasAdvancedPower && (
                            <div className="mt-6 border-t pt-4">
                                <h4 className="text-md font-medium text-main mb-3">Advanced Options</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-app p-4 rounded-md border">
                                    <div className="flex items-center">
                                        <input
                                            id="forcePowerOff"
                                            type="checkbox"
                                            checked={forcePowerOff}
                                            onChange={e => setForcePowerOff(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-main rounded"
                                        />
                                        <label htmlFor="forcePowerOff" className="ml-2 block text-sm text-main">
                                            Force Power Off Source VM
                                            <p className="text-xs text-secondary mt-0.5">Required if VMware Tools is not installed.</p>
                                        </label>
                                    </div>

                                    {/* NEW: Skip Preflight Checks */}
                                    <div className="flex items-center">
                                        <input
                                            id="skipPreflight"
                                            type="checkbox"
                                            checked={skipPreflight}
                                            onChange={e => setSkipPreflight(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-main rounded"
                                        />
                                        <label htmlFor="skipPreflight" className="ml-2 block text-sm text-main">
                                            Skip Preflight Checks
                                            <p className="text-xs text-secondary mt-0.5">Bypass validation (use with caution).</p>
                                        </label>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-main">Graceful Shutdown Timeout (Seconds)</label>
                                        <input
                                            type="number"
                                            value={shutdownTimeout}
                                            onChange={e => setShutdownTimeout(e.target.value)}
                                            placeholder="e.g. 300"
                                            className="mt-1 block w-full form-input text-sm"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-main">Default Network Interface Model</label>
                                        <select
                                            value={defaultModel}
                                            onChange={e => setDefaultModel(e.target.value)}
                                            className="mt-1 block w-full form-select text-sm"
                                        >
                                            <option value="">Auto (Default)</option>
                                            <option value="e1000">e1000</option>
                                            <option value="e1000e">e1000e</option>
                                            <option value="ne2k_pci">ne2k_pci</option>
                                            <option value="pcnet">pcnet</option>
                                            <option value="rtl8139">rtl8139</option>
                                            <option value="virtio">virtio</option>
                                        </select>
                                    </div>

                                    {/* NEW: Default Disk Bus Type */}
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-main">Default Disk Bus Type</label>
                                        <select
                                            value={diskBus}
                                            onChange={e => setDiskBus(e.target.value)}
                                            className="mt-1 block w-full form-select text-sm"
                                        >
                                            <option value="">Auto (Default)</option>
                                            <option value="virtio">virtio (High Performance)</option>
                                            <option value="scsi">scsi</option>
                                            <option value="sata">sata</option>
                                            <option value="usb">usb</option>
                                        </select>
                                        <p className="text-xs text-secondary mt-1">Specify bus type if automatic detection fails.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            case 3:
                return (
                    <div>
                        <div className="flex items-center">
                            <h3 className="text-lg font-medium text-main mb-2 flex-grow">Network Mapping</h3>
                            <button onClick={fetchNetworks} className="ml-2 text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                        </div>
                        <p className="text-sm text-secondary mb-4">
                            {sourceType === 'ova'
                                ? 'Select the target Harvester network for the imported VM.'
                                : 'Map source networks to target Harvester networks.'}
                        </p>
                        {harvesterNetworks.length === 0 ? (
                            <p className="text-sm text-secondary">No VLANs defined in Harvester.</p>
                        ) : sourceType === 'ova' ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center border-b pb-4 mb-2">
                                    <div className="md:col-span-5">
                                        <label className="block text-sm font-medium text-main mb-1">Target Harvester Network</label>
                                        <select
                                            value={networkMappings['default'] || ''}
                                            onChange={e => setNetworkMappings(prev => ({ ...prev, 'default': e.target.value }))}
                                            className="form-select w-full text-sm"
                                        >
                                            <option value="">Select Harvester Network</option>
                                            {harvesterNetworks.map(hnet => <option key={hnet} value={hnet}>{hnet}</option>)}
                                        </select>
                                    </div>

                                    {capabilities.hasAdvancedPower && (
                                        <div className="md:col-span-4">
                                            <label className="block text-sm font-medium text-main mb-1">Interface Model</label>
                                            <select
                                                onChange={e => setNetworkModels(prev => ({ ...prev, 'default': e.target.value }))}
                                                className="form-select w-full text-sm text-secondary"
                                                title="Specific Interface Model"
                                            >
                                                <option value="">Default Model</option>
                                                <option value="e1000">e1000</option>
                                                <option value="e1000e">e1000e</option>
                                                <option value="ne2k_pci">ne2k_pci</option>
                                                <option value="pcnet">pcnet</option>
                                                <option value="rtl8139">rtl8139</option>
                                                <option value="virtio">virtio</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {sourceNetworks.length === 0 ? (
                                    <p className="text-sm text-secondary italic">No source networks found for the selected VM. You can proceed without network mapping.</p>
                                ) : sourceNetworks.map(net => (
                                    <div key={net.key} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center border-b pb-4 mb-2 last:border-0 last:pb-0">
                                        <div className="md:col-span-4 font-mono text-sm text-main break-all flex items-center">
                                            <div className="bg-app text-secondary px-2 py-1 rounded text-xs mr-2 border border-main">Source</div>
                                            <div>
                                                {net.displayName}
                                                {engine === 'forklift' && net.id && <div className="text-xs text-secondary">{net.id}</div>}
                                            </div>
                                        </div>
                                        <div className="md:col-span-1 text-center hidden md:block">
                                            <ArrowRight className="mx-auto text-secondary opacity-70" />
                                        </div>
                                        <div className="md:col-span-4">
                                            <select
                                                onChange={e => setNetworkMappings(prev => ({ ...prev, [net.key]: e.target.value }))}
                                                className="form-select w-full text-sm"
                                            >
                                                <option value="">Select Harvester Network</option>
                                                {harvesterNetworks.map(hnet => <option key={hnet} value={hnet}>{hnet}</option>)}
                                            </select>
                                        </div>

                                        {engine !== 'forklift' && capabilities.hasAdvancedPower && (
                                            <div className="md:col-span-3">
                                                <select
                                                    onChange={e => setNetworkModels(prev => ({ ...prev, [net.key]: e.target.value }))}
                                                    className="form-select w-full text-sm text-secondary"
                                                    title="Specific Interface Model"
                                                >
                                                    <option value="">Default Model</option>
                                                    <option value="e1000">e1000</option>
                                                    <option value="e1000e">e1000e</option>
                                                    <option value="ne2k_pci">ne2k_pci</option>
                                                    <option value="pcnet">pcnet</option>
                                                    <option value="rtl8139">rtl8139</option>
                                                    <option value="virtio">virtio</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Forklift Default NIC Model */}
                        {engine === 'forklift' && sourceNetworks.length > 0 && (
                            <div className="mt-4 flex items-center gap-3 p-3 bg-app rounded border">
                                <label className="text-sm text-secondary whitespace-nowrap">Default NIC Model:</label>
                                <select value={defaultModel} onChange={e => setDefaultModel(e.target.value)} className="form-select text-sm w-48">
                                    <option value="">Default (virtio)</option>
                                    <option value="e1000">e1000</option>
                                    <option value="e1000e">e1000e</option>
                                    <option value="virtio">virtio</option>
                                    <option value="rtl8139">rtl8139</option>
                                    <option value="pcnet">pcnet</option>
                                </select>
                                <span className="text-xs text-secondary italic">Stored as Plan annotation</span>
                            </div>
                        )}

                        {/* Forklift Storage Mapping */}
                        {engine === 'forklift' && sourceDatastores.length > 0 && (
                            <div className="mt-6">
                                <h3 className="text-lg font-medium text-main mb-2">Storage Mapping</h3>
                                <p className="text-sm text-secondary mb-4">
                                    {selectedProviderType === 'ova'
                                        ? 'Map each OVA disk file to a target Harvester storage class.'
                                        : 'Map source datastores to target Harvester storage classes.'}
                                </p>
                                <div className="space-y-4">
                                    {sourceDatastores.map(ds => (
                                        <div key={ds.id} className="border-b pb-4 mb-2 last:border-0 last:pb-0">
                                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                                                <div className="md:col-span-4 font-mono text-sm text-main break-all flex items-center">
                                                    <div className="bg-app text-secondary px-2 py-1 rounded text-xs mr-2 border border-main">Source</div>
                                                    <div>
                                                        {ds.name}
                                                        <div className="text-xs text-secondary">{ds.id}</div>
                                                    </div>
                                                </div>
                                                <div className="md:col-span-1 text-center hidden md:block">
                                                    <ArrowRight className="mx-auto text-secondary opacity-70" />
                                                </div>
                                                <div className="md:col-span-4">
                                                    <select
                                                        value={forkliftStorageMappings[ds.id] || storageClass}
                                                        onChange={e => setForkliftStorageMappings(prev => ({ ...prev, [ds.id]: e.target.value }))}
                                                        className="form-select w-full text-sm"
                                                    >
                                                        <option value="">Select Storage Class</option>
                                                        {storageClasses.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                                                    </select>
                                                </div>
                                                <div className="md:col-span-3 flex gap-2">
                                                    <select
                                                        value={forkliftVolumeModes[ds.id] || ''}
                                                        onChange={e => setForkliftVolumeModes(prev => ({ ...prev, [ds.id]: e.target.value }))}
                                                        className="form-select w-full text-sm"
                                                        title="Volume Mode"
                                                    >
                                                        <option value="">Vol. Mode</option>
                                                        <option value="Block">Block</option>
                                                        <option value="Filesystem">Filesystem</option>
                                                    </select>
                                                    <select
                                                        value={forkliftAccessModes[ds.id] || ''}
                                                        onChange={e => setForkliftAccessModes(prev => ({ ...prev, [ds.id]: e.target.value }))}
                                                        className="form-select w-full text-sm"
                                                        title="Access Mode"
                                                    >
                                                        <option value="">Access Mode</option>
                                                        <option value="ReadWriteOnce">RWO</option>
                                                        <option value="ReadWriteMany">RWX</option>
                                                        <option value="ReadOnlyMany">ROX</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            case 4:
                return (
                    <div>
                        <h3 className="text-lg font-medium text-main mb-2">Review Plan</h3>
                        <div className="space-y-4 text-sm">
                            <div><strong>Engine:</strong> {engine === 'forklift' ? 'Forklift' : 'VM Import Controller'}</div>
                            <div><strong>Plan Name:</strong> {planName}</div>
                            <div><strong>Destination VM Name:</strong> {sourceType === 'ova' ? ovaVmName : (engine === 'forklift' && forkliftTargetName ? `${forkliftTargetName} (original: ${selectedVm?.name})` : selectedVm?.name)}</div>
                            {engine !== 'forklift' && <div><strong>Source Type:</strong> {sourceType === 'ova' ? 'OVA' : 'VMware vCenter'}</div>}
                            <div><strong>Target Namespace:</strong> {targetNamespace === 'create_new' ? `${newNamespace} (new)` : targetNamespace}</div>
                            <div><strong>Storage Class:</strong> {storageClass}</div>

                            {/* Review Forklift Options */}
                            {engine === 'forklift' && (
                                <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-100">
                                    <h4 className="font-medium text-blue-800">Forklift Settings:</h4>
                                    <ul className="list-disc list-inside pl-2 text-blue-800">
                                        <li>VM ID: {selectedVm?.id}</li>
                                        <li>Migrate Shared Disks: {migrateSharedDisks ? 'Yes' : 'No'}</li>
                                        <li>Populator Labels: {populatorLabels ? 'Yes' : 'No'}</li>
                                        <li>Warm Migration: {warmMigration ? 'Yes' : 'No'}</li>
                                        {defaultModel && <li>Default NIC Model: {defaultModel}</li>}
                                    </ul>
                                    {sourceNetworks.length > 0 && (
                                        <div className="mt-2">
                                            <h5 className="font-medium text-blue-800 text-xs">Network Mappings:</h5>
                                            <ul className="list-disc list-inside pl-2 text-blue-800 text-xs">
                                                {sourceNetworks.map(net => (
                                                    <li key={net.key}>{net.displayName} ({net.id}) → {networkMappings[net.key] || '(pod network)'}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {sourceDatastores.length > 0 && (
                                        <div className="mt-2">
                                            <h5 className="font-medium text-blue-800 text-xs">Storage Mappings:</h5>
                                            <ul className="list-disc list-inside pl-2 text-blue-800 text-xs">
                                                {sourceDatastores.map(ds => {
                                                    const vm = forkliftVolumeModes[ds.id];
                                                    const am = forkliftAccessModes[ds.id];
                                                    const extra = [vm, am].filter(Boolean).join(', ');
                                                    return <li key={ds.id}>{ds.name} ({ds.id}) → {forkliftStorageMappings[ds.id] || storageClass || '(none)'}{extra ? ` [${extra}]` : ''}</li>;
                                                })}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Review Advanced Options (VMIC only) */}
                            {engine !== 'forklift' && capabilities.hasAdvancedPower && (forcePowerOff || shutdownTimeout || defaultModel || skipPreflight || diskBus) && (
                                <div className="mt-2 p-2 bg-yellow-50 rounded border border-yellow-100">
                                    <h4 className="font-medium text-yellow-800">Advanced Settings:</h4>
                                    <ul className="list-disc list-inside pl-2 text-yellow-800">
                                        {forcePowerOff && <li>Force Power Off: Enabled</li>}
                                        {shutdownTimeout && <li>Shutdown Timeout: {shutdownTimeout}s</li>}
                                        {defaultModel && <li>Default Interface: {defaultModel}</li>}
                                        {skipPreflight && <li>Skip Validation: Yes</li>}
                                        {diskBus && <li>Disk Bus: {diskBus}</li>}
                                    </ul>
                                </div>
                            )}

                            <div>
                                <h4 className="font-medium mt-2">VM to Migrate:</h4>
                                <ul className="list-disc list-inside pl-4">
                                    <li>
                                        {sourceType === 'ova' ? ovaVmName : selectedVm?.name}
                                        {engine === 'forklift' && selectedVm?.id && <span className="text-secondary text-xs"> (ID: {selectedVm.id})</span>}
                                        {engine !== 'forklift' && sourceType !== 'ova' && <span className="text-secondary text-xs"> (Folder: {selectedVm?.folder || '/'})</span>}
                                    </li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-medium mt-2">Network Mappings:</h4>
                                <ul className="list-disc list-inside pl-4">
                                    {Object.entries(networkMappings).map(([key, value]) => (
                                        <li key={key}>
                                            {key} &rarr; {value}
                                            {engine !== 'forklift' && capabilities.hasAdvancedPower && networkModels[key] && <span className="text-xs text-secondary ml-2">[{networkModels[key]}]</span>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div>
            <Header title="Create Migration Plan" />
            <div className="bg-card p-6 shadow-md rounded-lg">
                {renderStepContent()}
            </div>
            <div className="mt-6 flex justify-between">
                <button onClick={onCancel} className="btn-secondary">Cancel</button>
                <div>
                    {step > 1 && <button onClick={() => setStep(s => s - 1)} className="btn-secondary mr-2">Back</button>}
                    {step < 4 && (
                        <button
                            onClick={() => {
                                if (step === 1) {
                                    const dnsRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
                                    if (!planName) {
                                        alert("Plan name is required.");
                                        return;
                                    }
                                    if (!dnsRegex.test(planName)) {
                                        alert("Plan name must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character.");
                                        return;
                                    }
                                    if (planName.length > 63) {
                                        alert("Plan name must be no more than 63 characters.");
                                        return;
                                    }
                                }
                                setStep(s => s + 1);
                            }}
                            disabled={vmNameConflict}
                            className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md disabled:opacity-50"
                        >
                            Next
                        </button>
                    )}
                    {step === 4 && <button onClick={handleSubmit} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md">Create Plan</button>}
                </div>
            </div>
        </div>
    );
};

const AboutPage = () => (
    <div className="space-y-8">
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-main">
                About VM Import UI
            </h1>
        </div>

        {/* Feature Cards Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            {/* Harvester Card */}
            <div className="bg-card text-main rounded-2xl p-8 flex flex-col items-center text-center shadow-xl border border-main">
                <div className="mb-6 h-16 flex items-center justify-center">
                    <img
                        src="https://harvesterhci.io/img/logo_horizontal.svg"
                        alt="Harvester"
                        className="h-full"
                    />
                </div>
                <h2 className="text-2xl font-bold mb-4">Harvester</h2>
                <p className="text-secondary leading-relaxed mb-8 flex-grow">
                    Harvester is a modern, open-source hyperconverged infrastructure (HCI) solution built on Kubernetes, KubeVirt, and Longhorn. It provides a familiar virtualization management interface on top of cloud-native technologies.
                </p>
                <a
                    href="https://harvesterhci.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#00af7e] hover:bg-[#00966c] text-white font-bold py-3 px-8 rounded-lg flex items-center transition-colors shadow-lg"
                >
                    Get Harvester <ExternalLink size={18} className="ml-2" />
                </a>
            </div>

            {/* SUSE Virtualization Card */}
            <div className="bg-[#0c322c] text-white rounded-2xl p-8 flex flex-col items-center text-center shadow-xl border border-[#1e4a3f]">
                <div className="mb-6 h-12 flex items-center">
                    <img
                        src="https://d12w0ryu9hjsx8.cloudfront.net/shared-header/1.7/assets/SUSE_Logo.svg"
                        alt="SUSE"
                        className="h-full"
                    />
                </div>
                <h2 className="text-2xl font-bold mb-4 text-white">SUSE Virtualization</h2>
                <p className="text-[#00af7e] leading-relaxed mb-8 flex-grow font-medium">
                    Harvester is the foundation for <strong className="text-white">SUSE Virtualization</strong>, an enterprise-grade platform offering world-class support, enhanced security, and seamless Rancher integration for mission-critical workloads.
                </p>
                <a
                    href="https://www.suse.com/products/virtualization"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white hover:bg-gray-100 text-[#0c322c] font-bold py-3 px-8 rounded-lg flex items-center transition-colors shadow-lg"
                >
                    Learn More <ExternalLink size={18} className="ml-2" />
                </a>
            </div>
        </div>

        <div className="bg-card shadow-md rounded-lg p-6 relative overflow-hidden border border-main">
            <a href="https://github.com/doccaz/vm-import-ui" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub" className="fixed top-0 right-0 z-50">
                <svg width="80" height="80" viewBox="0 0 250 250" style={{ fill: '#151513', color: '#fff', position: 'absolute', top: 0, border: 0, right: 0 }} aria-hidden="true">
                    <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
                    <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style={{ transformOrigin: '130px 106px' }} className="octo-arm"></path>
                    <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" className="octo-body"></path>
                </svg>
            </a>
            <style>{`.github-corner:hover .octo-arm{animation:octocat-wave 560ms ease-in-out}@keyframes octocat-wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-25deg)}40%,80%{transform:rotate(10deg)}}@media (max-width:500px){.github-corner:hover .octo-arm{animation:none}.github-corner .octo-arm{animation:octocat-wave 560ms ease-in-out}}`}</style>

            <h2 className="text-xl font-semibold mb-4 z-10 relative text-main">Harvester VM Import UI</h2>
            <p className="mb-2 z-10 relative text-main"><strong>Version:</strong> 1.7.0</p>
            <p className="mb-2 z-10 relative text-secondary font-medium">This UI provides a user-friendly interface for migrating virtual machines into Harvester / SUSE Virtualization clusters. It supports two migration engines: the native VM Import Controller and the Forklift (Konveyor) project, with sources including VMware vCenter, standalone ESXi hosts, and OVA/OVF files on NFS shares.</p>
            <p className="mb-6 italic text-sm text-secondary z-10 relative mt-2 border-l-4 border-blue-400 pl-3">Based off of an idea by Erico Mendonca (erico.mendonca@suse.com)</p>

            <h3 className="text-lg font-semibold mb-3 z-10 relative text-main">How to Use</h3>
            <div className="space-y-4 z-10 relative text-secondary">
                <div>
                    <h4 className="font-semibold text-main flex items-center mb-1"><List size={16} className="mr-1 text-blue-600" /> Migration Plans Tab</h4>
                    <p className="text-sm">
                        Your primary dashboard for managing imports, with subtabs for <strong>VM Import Controller</strong> and <strong>Forklift</strong> plans. Click <strong>Create</strong> to launch the Migration Plan Wizard. The wizard will guide you through:
                    </p>
                    <ul className="list-disc list-inside text-sm mt-1 ml-2 space-y-1">
                        <li>Choosing the migration engine (VM Import Controller or Forklift).</li>
                        <li>Selecting a source (vCenter, ESXi, OVA for VMIC; vSphere or OVA provider for Forklift).</li>
                        <li>Browsing the inventory tree and selecting a VM to import.</li>
                        <li>Configuring target Namespace, Storage Class, and network mappings.</li>
                        <li>Forklift-specific options: warm migration (vSphere only), shared disks, populator labels, per-datastore/per-disk storage mappings.</li>
                    </ul>
                    <p className="text-sm mt-1">From the dashboard, you can track <strong>live progress with per-disk conditions</strong>, examine YAML configurations, view debug logs, and re-run migrations (replacing existing Migration CRs if needed).</p>
                </div>

                <div>
                    <h4 className="font-semibold text-main flex items-center mb-1"><Server size={16} className="mr-1 text-blue-600" /> vCenter Sources Tab</h4>
                    <p className="text-sm">
                        Register VMware sources here, with subtabs for <strong>VM Import Controller</strong> sources and <strong>Forklift vSphere providers</strong>.
                    </p>
                    <ul className="list-disc list-inside text-sm mt-1 ml-2 space-y-1">
                        <li><strong>VM Import Controller:</strong> Add vCenter sources with endpoint URL, datacenter name, and credentials.</li>
                        <li><strong>Forklift:</strong> Create Forklift vSphere providers (vCenter or standalone ESXi) with their associated Secrets.</li>
                    </ul>
                    <p className="text-sm mt-1">Use the <strong>Explore</strong> function to browse inventory, manage VM power states, rename VMs, and edit MAC addresses.</p>
                </div>

                <div>
                    <h4 className="font-semibold text-main flex items-center mb-1"><Package size={16} className="mr-1 text-blue-600" /> OVA Sources Tab</h4>
                    <p className="text-sm">
                        Manage OVA-based sources, with subtabs for <strong>VM Import Controller</strong> and <strong>Forklift OVA providers</strong>.
                    </p>
                    <ul className="list-disc list-inside text-sm mt-1 ml-2 space-y-1">
                        <li><strong>VM Import Controller:</strong> Define HTTP/HTTPS endpoints serving .ova files, with optional authentication.</li>
                        <li><strong>Forklift:</strong> Create OVA (NFS) providers pointing to NFS shares containing OVA/OVF files. Forklift auto-deploys an OVA server pod to scan and discover available VMs.</li>
                    </ul>
                </div>

                <div>
                    <h4 className="font-semibold text-main flex items-center mb-1"><Info size={16} className="mr-1 text-blue-600" /> About Tab</h4>
                    <p className="text-sm">
                        You are here! This tab provides application versioning, attribution, and documentation on how to navigate the utility.
                    </p>
                </div>
            </div>
        </div>
    </div>
);

// --- Forklift Components ---

const getForkliftConditionStatus = (conditions, type) => {
    if (!conditions || !Array.isArray(conditions)) return null;
    return conditions.find(c => c.type === type);
};

const ForkliftStatusBadge = ({ conditions }) => {
    const readyCond = getForkliftConditionStatus(conditions, 'Ready');
    if (!readyCond) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-app text-main">Pending</span>;
    if (readyCond.status === 'True') return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Ready</span>;
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800" title={readyCond.message}>{readyCond.reason || 'Not Ready'}</span>;
};

const ForkliftProvidersTable = ({ providers, onEdit, onDelete, onViewDetails, onExplore, sortConfig, onSort }) => (
    <div className="bg-card shadow-md rounded-lg overflow-x-auto border border-main">
        <table className="min-w-full divide-y divide-main">
            <thead className="bg-app opacity-90">
                <tr>
                    <SortableHeader label="Created" sortKey="metadata.creationTimestamp" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Name" sortKey="metadata.name" currentSort={sortConfig} onSort={onSort} />
                    <SortableHeader label="Namespace" sortKey="metadata.namespace" currentSort={sortConfig} onSort={onSort} />
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">URL</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider"></th>
                </tr>
            </thead>
            <tbody className="bg-card divide-y divide-main">
                {(!providers || providers.length === 0) ? (
                    <tr>
                        <td colSpan="7" className="px-6 py-4 text-center text-sm text-secondary">No Forklift source providers found.</td>
                    </tr>
                ) : (
                    providers.map(provider => (
                        <tr key={provider.metadata?.uid || provider.metadata?.name} className="hover:bg-app">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{formatDate(provider.metadata?.creationTimestamp)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-main">{provider.metadata?.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{provider.metadata?.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{provider.spec?.type === 'ova' ? 'OVA (NFS)' : provider.spec?.settings?.sdkEndpoint === 'esxi' ? 'ESXi' : 'vCenter'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary max-w-xs truncate" title={provider.spec?.url}>{provider.spec?.url}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <ForkliftStatusBadge conditions={provider.status?.conditions} />
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                {provider.spec?.type !== 'ova' && <button onClick={() => onExplore(provider)} title="Explore Inventory" className="text-indigo-600 hover:text-indigo-800"><Search size={18} /></button>}
                                <button onClick={() => onEdit(provider)} title="Edit" className="text-blue-600 hover:text-blue-800"><Edit size={18} /></button>
                                <button onClick={() => onDelete(provider)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                                <button onClick={() => onViewDetails(provider)} className="text-blue-600 hover:text-blue-800">Details</button>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    </div>
);

const ForkliftProviderWizard = ({ onCancel, onSave, source, defaultNamespace, defaultProviderType }) => {
    const [name, setName] = useState('');
    const [namespace, setNamespace] = useState(defaultNamespace || 'forklift');
    const [url, setUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [sdkEndpoint, setSdkEndpoint] = useState('vcenter');
    const [providerType, setProviderType] = useState(defaultProviderType || 'vsphere');
    const isEditMode = !!source;

    useEffect(() => {
        if (isEditMode) {
            setName(source.metadata.name);
            setNamespace(source.metadata.namespace);
            setUrl(source.spec.url || '');
            setUsername(source.spec.username || '');
            setSdkEndpoint(source.spec?.settings?.sdkEndpoint || 'vcenter');
            setProviderType(source.spec?.type || 'vsphere');
        }
    }, [source, isEditMode]);

    const handleSubmit = () => {
        if (providerType === 'ova') {
            onSave({ name, namespace, url, providerType: 'ova' }, isEditMode);
        } else {
            onSave({ name, namespace, url, username, password, sdkEndpoint, providerType: 'vsphere' }, isEditMode);
        }
    };

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-lg">
                <div className="p-4 border-b">
                    <h2 className="text-xl font-semibold">{isEditMode ? 'Edit' : 'Create'} Forklift Provider</h2>
                </div>
                <div className="p-6 space-y-4">
                    {!isEditMode && (
                        <div>
                            <label className="block text-sm font-medium text-main">Provider Type</label>
                            <div className="mt-1 flex space-x-4">
                                <label className="inline-flex items-center cursor-pointer" title="Import VMs from a VMware vSphere environment (vCenter or ESXi).">
                                    <input type="radio" className="form-radio text-blue-600" name="providerType" value="vsphere" checked={providerType === 'vsphere'} onChange={() => setProviderType('vsphere')} />
                                    <span className="ml-2 text-sm text-main">vSphere</span>
                                </label>
                                <label className="inline-flex items-center cursor-pointer" title="Import VMs from OVA/OVF files on an NFS share.">
                                    <input type="radio" className="form-radio text-blue-600" name="providerType" value="ova" checked={providerType === 'ova'} onChange={() => setProviderType('ova')} />
                                    <span className="ml-2 text-sm text-main">OVA (NFS)</span>
                                </label>
                            </div>
                            <p className="text-xs text-secondary mt-1">
                                {providerType === 'ova'
                                    ? 'Import virtual machines from OVA/OVF files stored on an NFS share. Forklift will scan the share and discover available VMs.'
                                    : 'Import virtual machines from a live VMware vSphere environment.'}
                            </p>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-main">Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-main">Namespace</label>
                        <input type="text" value={namespace} onChange={e => setNamespace(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input" />
                    </div>
                    {providerType === 'vsphere' && (
                        <div>
                            <label className="block text-sm font-medium text-main">Endpoint Type</label>
                            <div className="mt-1 flex space-x-4">
                                <label className="inline-flex items-center cursor-pointer" title="Connect to a VMware vCenter Server that manages one or more ESXi hosts.">
                                    <input type="radio" className="form-radio text-blue-600" name="sdkEndpoint" value="vcenter" checked={sdkEndpoint === 'vcenter'} onChange={() => setSdkEndpoint('vcenter')} />
                                    <span className="ml-2 text-sm text-main">vCenter Server</span>
                                </label>
                                <label className="inline-flex items-center cursor-pointer" title="Connect directly to a standalone ESXi host (not managed by vCenter).">
                                    <input type="radio" className="form-radio text-blue-600" name="sdkEndpoint" value="esxi" checked={sdkEndpoint === 'esxi'} onChange={() => setSdkEndpoint('esxi')} />
                                    <span className="ml-2 text-sm text-main">Standalone ESXi</span>
                                </label>
                            </div>
                            <p className="text-xs text-secondary mt-1">
                                {sdkEndpoint === 'esxi'
                                    ? 'Connects directly to an ESXi host using the esx:// protocol. Use this when your host is not managed by a vCenter Server.'
                                    : 'Connects to a vCenter Server using the vpx:// protocol. This is the default for most VMware environments.'}
                            </p>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-main">
                            {providerType === 'ova' ? 'NFS Path' : sdkEndpoint === 'esxi' ? 'ESXi Host URL' : 'vCenter URL'}
                        </label>
                        <input type="text" placeholder={providerType === 'ova' ? '10.0.0.1:/exports/vms' : sdkEndpoint === 'esxi' ? 'https://esxi-host.example.com/sdk' : 'https://vcenter.example.com/sdk'} value={url} onChange={e => setUrl(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    {providerType === 'vsphere' && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-main">Username</label>
                                <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full form-input" placeholder={sdkEndpoint === 'esxi' ? 'root' : 'administrator@vsphere.local'} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-main">Password</label>
                                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full form-input" placeholder={isEditMode ? "Leave blank to keep existing password" : ""} />
                            </div>
                        </>
                    )}
                </div>
                <div className="p-4 border-t flex justify-end space-x-2">
                    <button onClick={onCancel} className="btn-secondary">Cancel</button>
                    <button onClick={handleSubmit} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md">Save</button>
                </div>
            </div>
        </div>
    );
};

const ForkliftProviderDetails = ({ provider, onClose }) => {
    const [yamlContent, setYamlContent] = useState('');
    const [showYaml, setShowYaml] = useState(false);
    const [isLoadingYaml, setIsLoadingYaml] = useState(false);

    const fetchYaml = async () => {
        setIsLoadingYaml(true);
        try {
            const response = await fetch(`/api/v1/forklift/providers/${provider.metadata.namespace}/${provider.metadata.name}/yaml`);
            const data = await response.text();
            setYamlContent(data || "Could not generate YAML.");
        } catch (err) {
            setYamlContent("Failed to fetch YAML.");
        } finally {
            setIsLoadingYaml(false);
        }
    };

    const handleShowYaml = () => {
        if (showYaml) {
            setShowYaml(false);
        } else {
            setShowYaml(true);
            fetchYaml();
        }
    };

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold text-main">{provider.metadata.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <h3 className="text-lg font-medium text-main mb-2">Provider Summary</h3>
                        <div className="p-3 bg-app rounded-md border text-sm space-y-1">
                            <p><strong>Type:</strong> {provider.spec?.type}</p>
                            <p><strong>URL:</strong> {provider.spec?.url}</p>
                            <p><strong>Secret:</strong> {provider.spec?.secret?.namespace}/{provider.spec?.secret?.name}</p>
                            <p><strong>SDK Endpoint:</strong> {provider.spec?.settings?.sdkEndpoint || 'default'}</p>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-main mb-2">Conditions</h3>
                        <div className="space-y-1">
                            {(provider.status?.conditions || []).map((c, i) => (
                                <div key={i} className="flex items-start text-sm border-b border-gray-50 last:border-0 pb-1">
                                    <span className="mt-0.5">
                                        {c.status === 'True' ? <CheckCircle2 size={14} className="text-green-500 mr-1" /> : <XCircle size={14} className="text-red-500 mr-1" />}
                                    </span>
                                    <div className="flex-grow">
                                        <div className="flex justify-between items-center">
                                            <span className="font-medium text-main">{c.type}</span>
                                            <span className="text-[10px] text-secondary opacity-70 font-mono">{formatDate(c.lastTransitionTime)}</span>
                                        </div>
                                        <div className="text-secondary text-xs italic">{c.message || ''}</div>
                                    </div>
                                </div>
                            ))}
                            {(!provider.status?.conditions || provider.status.conditions.length === 0) && <p className="text-xs text-secondary italic">No conditions reported yet.</p>}
                        </div>
                    </div>
                    <div>
                        <button onClick={handleShowYaml} className="text-sm text-blue-600 hover:underline">
                            {showYaml ? 'Hide' : 'View'} YAML
                        </button>
                        {showYaml && (
                            <div className="mt-2 p-2 border rounded-md bg-gray-900 text-white font-mono text-xs max-h-64 overflow-y-auto relative group">
                                <CopyButton text={yamlContent} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100" />
                                <pre>{isLoadingYaml ? 'Loading...' : yamlContent}</pre>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t bg-app text-right rounded-b-lg">
                    <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-md font-semibold transition-colors">Close</button>
                </div>
            </div>
        </div>
    );
};

const getForkliftPlanStatus = (plan) => {
    const conditions = plan.status?.conditions || [];
    const readyCond = conditions.find(c => c.type === 'Ready');
    const executingCond = conditions.find(c => c.type === 'Executing');
    const succeededCond = conditions.find(c => c.type === 'Succeeded');
    const failedCond = conditions.find(c => c.type === 'Failed');

    if (failedCond && failedCond.status === 'True') return 'Failed';
    if (succeededCond && succeededCond.status === 'True') return 'Succeeded';
    if (executingCond && executingCond.status === 'True') return 'Executing';
    if (readyCond && readyCond.status === 'True') return 'Ready';
    if (readyCond && readyCond.status === 'False') return 'Not Ready';
    return 'Pending';
};

// Small helper component for lazy-fetching related object status in the expanded row
const ForkliftRelatedObjectStatus = ({ url, label }) => {
    const [status, setStatus] = useState(null);
    useEffect(() => {
        if (!url) { setStatus('N/A'); return; }
        fetch(url).then(r => r.ok ? r.json() : null).then(data => {
            if (!data) { setStatus('Not Found'); return; }
            const conds = data.status?.conditions || [];
            const ready = conds.find(c => c.type === 'Ready');
            setStatus(ready?.status === 'True' ? 'Ready' : ready ? 'Not Ready' : 'Pending');
        }).catch(() => setStatus('Error'));
    }, [url]);
    const icon = status === 'Ready' ? <CheckCircle2 size={12} className="text-green-500" />
        : status === 'Not Ready' ? <XCircle size={12} className="text-red-500" />
        : status === 'Pending' || status === null ? <Loader size={12} className="text-secondary animate-spin" />
        : <AlertTriangle size={12} className="text-yellow-500" />;
    return (
        <div className="flex items-center gap-1.5 text-xs text-main">
            {icon} <span className="text-secondary">{label}:</span> <span>{status || '...'}</span>
        </div>
    );
};

const ForkliftPlansTable = ({ plans, onDelete, onViewDetails, sortConfig, onSort, expandedPlans, toggleExpand, onRunMigration }) => {
    const renderStatusBadge = (status) => {
        const colors = {
            'Ready': 'bg-blue-100 text-blue-800',
            'Executing': 'bg-yellow-100 text-yellow-800',
            'Succeeded': 'bg-green-100 text-green-800',
            'Failed': 'bg-red-100 text-red-800',
            'Not Ready': 'bg-red-100 text-red-800',
            'Pending': 'bg-app text-main',
        };
        return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors['Pending']}`}>{status}</span>;
    };

    return (
        <div className="bg-card shadow-md rounded-lg overflow-x-auto border border-main">
            <table className="min-w-full divide-y divide-main">
                <thead className="bg-app opacity-90">
                    <tr>
                        <th className="px-4 py-3"></th>
                        <SortableHeader label="Created" sortKey="metadata.creationTimestamp" currentSort={sortConfig} onSort={onSort} />
                        <SortableHeader label="Name" sortKey="metadata.name" currentSort={sortConfig} onSort={onSort} />
                        <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">VMs</th>
                        <SortableHeader label="Target NS" sortKey="spec.targetNamespace" currentSort={sortConfig} onSort={onSort} />
                        <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider"></th>
                    </tr>
                </thead>
                <tbody className="bg-card divide-y divide-main">
                    {(!plans || plans.length === 0) ? (
                        <tr>
                            <td colSpan="7" className="px-6 py-4 text-center text-sm text-secondary">No Forklift migration plans found.</td>
                        </tr>
                    ) : (
                        plans.map(plan => {
                            const uid = plan.metadata?.uid || plan.metadata?.name;
                            const status = getForkliftPlanStatus(plan);
                            const vms = plan.spec?.vms || [];
                            const netRef = plan.spec?.map?.network;
                            const stRef = plan.spec?.map?.storage;
                            const provRef = plan.spec?.provider?.source;
                            return (
                                <React.Fragment key={uid}>
                                    <tr className="hover:bg-app transition-colors">
                                        <td className="px-4 py-4 whitespace-nowrap text-sm text-secondary">
                                            <button onClick={() => toggleExpand(uid)} className="p-1 hover:bg-app rounded-full transition-colors">
                                                {expandedPlans.has(uid) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{formatDate(plan.metadata?.creationTimestamp)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-main">{plan.metadata?.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">{renderStatusBadge(status)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{vms.map(v => v.name).join(', ') || 'N/A'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary">{plan.spec?.targetNamespace}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2 pr-4">
                                            {status === 'Ready' && (
                                                <button onClick={() => onRunMigration(plan)} title="Run Migration" className="text-green-600 hover:text-green-800"><Play size={18} /></button>
                                            )}
                                            <button onClick={() => onDelete(plan)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                                            <button onClick={() => onViewDetails(plan)} className="text-blue-600 hover:text-blue-800">Details</button>
                                        </td>
                                    </tr>
                                    {expandedPlans.has(uid) && (
                                        <tr className="bg-app">
                                            <td colSpan="7" className="px-6 py-4">
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                    <div>
                                                        <h4 className="text-xs font-bold text-secondary uppercase tracking-wider mb-2">Related Objects</h4>
                                                        <div className="space-y-1.5 p-2 bg-card rounded border">
                                                            <ForkliftRelatedObjectStatus
                                                                url={provRef ? `/api/v1/forklift/providers/${provRef.namespace}/${provRef.name}` : null}
                                                                label="Provider"
                                                            />
                                                            <ForkliftRelatedObjectStatus
                                                                url={netRef ? `/api/v1/forklift/networkmaps/${netRef.namespace}/${netRef.name}` : null}
                                                                label="NetworkMap"
                                                            />
                                                            <ForkliftRelatedObjectStatus
                                                                url={stRef ? `/api/v1/forklift/storagemaps/${stRef.namespace}/${stRef.name}` : null}
                                                                label="StorageMap"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-bold text-secondary uppercase tracking-wider mb-2">Conditions</h4>
                                                        <div className="space-y-1 max-h-48 overflow-y-auto pr-2">
                                                            {(plan.status?.conditions || []).map((c, i) => (
                                                                <div key={i} className="flex items-start text-sm border-b border-gray-50 last:border-0 pb-1">
                                                                    <span className="mt-0.5">
                                                                        {c.status === 'True' ? <CheckCircle2 size={14} className="text-green-500 mr-1" /> : <XCircle size={14} className="text-red-500 mr-1" />}
                                                                    </span>
                                                                    <div className="flex-grow">
                                                                        <div className="flex justify-between items-center">
                                                                            <span className="font-medium text-main">{c.type}</span>
                                                                            <span className="text-[10px] text-secondary opacity-70 font-mono">{formatDate(c.lastTransitionTime)}</span>
                                                                        </div>
                                                                        <div className="text-secondary text-xs italic">{c.message || ''}</div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {(!plan.status?.conditions || plan.status.conditions.length === 0) && <p className="text-xs text-secondary italic">No conditions reported yet.</p>}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-bold text-secondary uppercase tracking-wider mb-2">VMs</h4>
                                                        <div className="space-y-2">
                                                            {vms.map((vm, i) => (
                                                                <div key={i} className="flex items-center p-2 bg-card rounded border shadow-sm text-sm">
                                                                    <HardDrive size={14} className="mr-2 text-secondary" />
                                                                    <span className="text-main font-medium">{vm.name}</span>
                                                                    <span className="text-xs text-secondary ml-2 font-mono">({vm.id})</span>
                                                                </div>
                                                            ))}
                                                            {(() => {
                                                                const ann = plan.metadata?.annotations || {};
                                                                const cpu = ann['migration.harvesterhci.io/original-cpu'];
                                                                const mem = ann['migration.harvesterhci.io/original-memory-mb'];
                                                                const disk = ann['migration.harvesterhci.io/original-disk-size-gb'];
                                                                return (cpu || mem || disk) ? (
                                                                    <div className="flex flex-wrap gap-3 text-[11px] p-2 bg-blue-500/10 rounded-md border border-blue-500/20 items-center mt-1">
                                                                        <span className="font-bold text-blue-700 uppercase tracking-tight">Source:</span>
                                                                        {cpu && <span className="flex items-center gap-1"><Cpu size={10} className="text-secondary" />{cpu} vCPU</span>}
                                                                        {mem && <span className="flex items-center gap-1"><MemoryStick size={10} className="text-secondary" />{formatBytes(parseInt(mem) * 1024 * 1024, 0)}</span>}
                                                                        {disk && <span className="flex items-center gap-1"><HardDrive size={10} className="text-secondary" />{disk} GB</span>}
                                                                    </div>
                                                                ) : null;
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
};

const ForkliftPlanDetails = ({ plan, onClose, onRunMigration, forkliftNamespace }) => {
    const [activeTab, setActiveTab] = useState('overview');
    const [logs, setLogs] = useState('');
    const [yamlContent, setYamlContent] = useState('');
    const [yamlObject, setYamlObject] = useState('plan');
    const [debugMode, setDebugMode] = useState('logs'); // 'logs' or 'yaml'
    const [isLoadingDebug, setIsLoadingDebug] = useState(false);
    const [onlyRelevantLogs, setOnlyRelevantLogs] = useState(true);
    const [errorsOnlyLogs, setErrorsOnlyLogs] = useState(false);
    const [followLogs, setFollowLogs] = useState(true);
    const followLogsRef = useRef(true);
    const [fontSize, setFontSize] = useState(10);
    const logsEndRef = useRef(null);
    const [networkMap, setNetworkMap] = useState(null);
    const [storageMap, setStorageMap] = useState(null);
    const [migration, setMigration] = useState(null);
    const [provider, setProvider] = useState(null);

    // Keep ref in sync with state
    useEffect(() => { followLogsRef.current = followLogs; }, [followLogs]);

    // Fetch all related objects
    const fetchRelatedObjects = useCallback(() => {
        const netRef = plan.spec?.map?.network;
        const stRef = plan.spec?.map?.storage;
        const provRef = plan.spec?.provider?.source;
        if (netRef?.name && netRef?.namespace) {
            fetch(`/api/v1/forklift/networkmaps/${netRef.namespace}/${netRef.name}`)
                .then(r => r.ok ? r.json() : null).then(setNetworkMap).catch(() => {});
        }
        if (stRef?.name && stRef?.namespace) {
            fetch(`/api/v1/forklift/storagemaps/${stRef.namespace}/${stRef.name}`)
                .then(r => r.ok ? r.json() : null).then(setStorageMap).catch(() => {});
        }
        if (provRef?.name && provRef?.namespace) {
            fetch(`/api/v1/forklift/providers/${provRef.namespace}/${provRef.name}`)
                .then(r => r.ok ? r.json() : null).then(setProvider).catch(() => {});
        }
        fetch(`/api/v1/forklift/plans/${plan.metadata.namespace}/${plan.metadata.name}/migration`)
            .then(r => r.ok ? r.json() : null).then(data => {
                if (data && !data.message) setMigration(data);
            }).catch(() => {});
    }, [plan]);

    useEffect(() => { fetchRelatedObjects(); }, [fetchRelatedObjects]);

    const fetchLogs = useCallback(async (showAll = !onlyRelevantLogs, errorsFilter = errorsOnlyLogs, isBackground = false) => {
        if (!isBackground) setIsLoadingDebug(true);
        try {
            const ns = forkliftNamespace || plan.metadata.namespace;
            const params = new URLSearchParams({ forkliftNamespace: ns });
            if (showAll) params.set('all', 'true');
            if (errorsFilter) params.set('errors', 'true');
            const response = await fetch(`/api/v1/forklift/plans/${plan.metadata.namespace}/${plan.metadata.name}/logs?${params}`);
            const data = await response.text();
            setLogs(data || "No logs found.");
        } catch (err) {
            setLogs("Failed to fetch logs.");
        } finally {
            if (!isBackground) setIsLoadingDebug(false);
        }
    }, [onlyRelevantLogs, errorsOnlyLogs, plan.metadata.namespace, plan.metadata.name, forkliftNamespace]);

    useEffect(() => {
        let interval;
        if (activeTab === 'debug' && debugMode === 'logs') {
            interval = setInterval(() => {
                if (followLogsRef.current) fetchLogs(!onlyRelevantLogs, errorsOnlyLogs, true);
            }, 2000);
        }
        return () => clearInterval(interval);
    }, [activeTab, debugMode, onlyRelevantLogs, errorsOnlyLogs, fetchLogs]);

    useEffect(() => {
        if (followLogs && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, followLogs]);

    const fetchYaml = async (objectType = yamlObject) => {
        setIsLoadingDebug(true);
        try {
            const ns = plan.metadata.namespace;
            const name = plan.metadata.name;
            const urls = {
                plan: `/api/v1/forklift/plans/${ns}/${name}/yaml`,
                networkmap: `/api/v1/forklift/networkmaps/${plan.spec?.map?.network?.namespace || ns}/${plan.spec?.map?.network?.name}/yaml`,
                storagemap: `/api/v1/forklift/storagemaps/${plan.spec?.map?.storage?.namespace || ns}/${plan.spec?.map?.storage?.name}/yaml`,
                migration: `/api/v1/forklift/migrations/${ns}/${name}-migration/yaml`,
                provider: `/api/v1/forklift/providers/${plan.spec?.provider?.source?.namespace || ns}/${plan.spec?.provider?.source?.name}/yaml`,
            };
            const response = await fetch(urls[objectType] || urls.plan);
            const data = await response.ok ? await response.text() : `Failed to fetch ${objectType} YAML (${response.status}).`;
            setYamlContent(data || "Could not generate YAML.");
        } catch (err) {
            setYamlContent(`Failed to fetch ${objectType} YAML.`);
        } finally {
            setIsLoadingDebug(false);
        }
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        if (tab === 'debug' && !logs && debugMode === 'logs') fetchLogs();
        if (tab === 'debug' && !yamlContent && debugMode === 'yaml') fetchYaml();
    };

    const status = getForkliftPlanStatus(plan);
    const isMapReady = (obj) => obj?.status?.conditions?.find(c => c.type === 'Ready')?.status === 'True';

    const detailTabs = [
        { key: 'overview', label: 'Overview' },
        { key: 'mappings', label: 'Mappings' },
        { key: 'migration', label: 'Migration' },
        { key: 'conditions', label: 'Conditions' },
        { key: 'debug', label: 'Debug' },
    ];

    const renderConditionsList = (conditions, emptyMsg) => (
        <div className="space-y-1">
            {(conditions || []).length === 0
                ? <p className="text-xs text-secondary italic">{emptyMsg || 'None'}</p>
                : conditions.map((c, i) => (
                    <div key={i} className="flex items-start text-sm border-b border-gray-50 last:border-0 pb-1">
                        <span className="mt-0.5">
                            {c.status === 'True' ? <CheckCircle2 size={14} className="text-green-500 mr-1" /> : <XCircle size={14} className="text-red-500 mr-1" />}
                        </span>
                        <div className="flex-grow">
                            <div className="flex justify-between items-center">
                                <span className="font-medium text-main">{c.type}</span>
                                {c.lastTransitionTime && <span className="text-[10px] text-secondary opacity-70 font-mono ml-2">{formatDate(c.lastTransitionTime)}</span>}
                            </div>
                            {c.message && <div className="text-secondary text-xs italic">{c.message}</div>}
                            {c.reason && c.reason !== c.type && <div className="text-secondary text-[10px]">Reason: {c.reason}</div>}
                        </div>
                    </div>
                ))
            }
        </div>
    );

    const getAnnotation = (key) => plan.metadata?.annotations?.[key];
    const originalCpu = getAnnotation('migration.harvesterhci.io/original-cpu');
    const originalMemoryMB = getAnnotation('migration.harvesterhci.io/original-memory-mb');
    const originalDiskGB = getAnnotation('migration.harvesterhci.io/original-disk-size-gb');
    const originalDisks = (() => { try { return JSON.parse(getAnnotation('migration.harvesterhci.io/original-disks') || '[]'); } catch { return []; } })();
    const originalNetworks = (() => { try { return JSON.parse(getAnnotation('migration.harvesterhci.io/original-networks') || '[]'); } catch { return []; } })();
    const defaultNicModel = getAnnotation('migration.harvesterhci.io/default-nic-model');
    const hasVmCharacteristics = originalCpu || originalMemoryMB || originalDiskGB || originalDisks.length > 0 || originalNetworks.length > 0;

    const renderOverviewTab = () => (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">Plan Info</h3>
                    <div className="p-3 bg-app rounded-md border text-sm">
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                            <span className="text-secondary">Status:</span>
                            <ForkliftStatusBadge conditions={plan.status?.conditions} />
                            <span className="text-secondary">Namespace:</span>
                            <span className="text-main font-mono text-xs">{plan.metadata.namespace}</span>
                            <span className="text-secondary">Target NS:</span>
                            <span className="text-main font-mono text-xs">{plan.spec?.targetNamespace}</span>
                            <span className="text-secondary">Shared Disks:</span>
                            <span className="text-main">{plan.spec?.migrateSharedDisks ? 'Yes' : 'No'}</span>
                            <span className="text-secondary">Warm Migration:</span>
                            <span className="text-main">{plan.spec?.warm ? 'Yes' : 'No'}</span>
                            <span className="text-secondary">Created:</span>
                            <span className="text-main text-xs">{formatDate(plan.metadata.creationTimestamp)}</span>
                            {defaultNicModel && <>
                                <span className="text-secondary">NIC Model:</span>
                                <span className="text-main">{defaultNicModel}</span>
                            </>}
                        </div>
                    </div>
                </div>
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">Related Objects</h3>
                    <div className="p-3 bg-app rounded-md border text-sm space-y-2">
                        <div className="flex items-center gap-2">
                            {provider ? (isMapReady(provider) ? <CheckCircle2 size={14} className="text-green-500" /> : <XCircle size={14} className="text-red-500" />) : <Loader size={14} className="animate-spin text-secondary" />}
                            <span className="text-secondary">Provider:</span>
                            <span className="text-main font-mono text-xs">{plan.spec?.provider?.source?.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {networkMap ? (isMapReady(networkMap) ? <CheckCircle2 size={14} className="text-green-500" /> : <XCircle size={14} className="text-red-500" />) : <Loader size={14} className="animate-spin text-secondary" />}
                            <span className="text-secondary">NetworkMap:</span>
                            <span className="text-main font-mono text-xs">{plan.spec?.map?.network?.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {storageMap ? (isMapReady(storageMap) ? <CheckCircle2 size={14} className="text-green-500" /> : <XCircle size={14} className="text-red-500" />) : <Loader size={14} className="animate-spin text-secondary" />}
                            <span className="text-secondary">StorageMap:</span>
                            <span className="text-main font-mono text-xs">{plan.spec?.map?.storage?.name}</span>
                        </div>
                        {migration && (
                            <div className="flex items-center gap-2">
                                {migration.status?.conditions?.find(c => c.type === 'Succeeded')?.status === 'True'
                                    ? <CheckCircle2 size={14} className="text-green-500" />
                                    : migration.status?.conditions?.find(c => c.type === 'Running')?.status === 'True'
                                    ? <Loader size={14} className="animate-spin text-blue-500" />
                                    : <AlertTriangle size={14} className="text-yellow-500" />}
                                <span className="text-secondary">Migration:</span>
                                <span className="text-main font-mono text-xs">{migration.metadata?.name}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {hasVmCharacteristics && (
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">Source VM Characteristics</h3>
                    <div className="p-3 bg-app rounded-md border text-sm space-y-3">
                        <div className="flex flex-wrap gap-4">
                            {originalCpu && (
                                <div className="flex items-center gap-1">
                                    <Cpu size={14} className="text-secondary" />
                                    <span className="text-main font-medium">{originalCpu} vCPU</span>
                                </div>
                            )}
                            {originalMemoryMB && (
                                <div className="flex items-center gap-1">
                                    <MemoryStick size={14} className="text-secondary" />
                                    <span className="text-main font-medium">{formatBytes(parseInt(originalMemoryMB) * 1024 * 1024, 0)}</span>
                                </div>
                            )}
                            {originalDiskGB && (
                                <div className="flex items-center gap-1">
                                    <HardDrive size={14} className="text-secondary" />
                                    <span className="text-main font-medium">{originalDiskGB} GB total</span>
                                </div>
                            )}
                        </div>
                        {originalDisks.length > 0 && (
                            <div>
                                <h4 className="text-xs font-semibold text-secondary mb-1">Disks</h4>
                                <div className="space-y-1">
                                    {originalDisks.map((disk, i) => {
                                        const sizeGB = disk.capacityGB || (disk.capacity ? (disk.capacity / (1024 * 1024 * 1024)).toFixed(1) : null);
                                        return (
                                        <div key={i} className="flex items-center text-xs gap-2 p-1 bg-card rounded border">
                                            <HardDrive size={10} className="text-secondary" />
                                            <span className="text-main font-mono">{disk.name || disk.path || `Disk ${i + 1}`}</span>
                                            {sizeGB && <span className="text-secondary ml-auto">{sizeGB} GB</span>}
                                            {disk.busType && <span className="text-secondary text-[10px]">({disk.busType})</span>}
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {originalNetworks.length > 0 && (
                            <div>
                                <h4 className="text-xs font-semibold text-secondary mb-1">Networks</h4>
                                <div className="space-y-1">
                                    {originalNetworks.map((net, i) => (
                                        <div key={i} className="flex items-center text-xs gap-2 p-1 bg-card rounded border">
                                            <Network size={10} className="text-secondary" />
                                            <span className="text-main font-mono">{net.name || net.id || `NIC ${i + 1}`}</span>
                                            {net.id && net.name && <span className="text-secondary ml-1">({net.id})</span>}
                                            {net.mac && <span className="text-secondary ml-auto font-mono">{net.mac}</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            <div>
                <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">VMs in Plan</h3>
                <div className="space-y-2">
                    {(plan.spec?.vms || []).map((vm, i) => {
                        const vmStatus = migration?.status?.vms?.find(v => v.id === vm.id);
                        return (
                            <div key={i} className="p-2 bg-app rounded border text-sm">
                                <div className="flex items-center">
                                    <HardDrive size={14} className="mr-2 text-secondary" />
                                    <span className="text-main font-medium">{vm.name}</span>
                                    <span className="text-xs text-secondary ml-2 font-mono">({vm.id})</span>
                                    {vmStatus?.phase && <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">{vmStatus.phase}</span>}
                                </div>
                                {vmStatus?.pipeline && (
                                    <div className="mt-2 ml-6 space-y-1">
                                        {vmStatus.pipeline.map((step, j) => (
                                            <div key={j} className="flex items-center text-xs gap-2">
                                                {step.phase === 'Completed' ? <CheckCircle2 size={10} className="text-green-500" />
                                                    : step.phase === 'Running' ? <Loader size={10} className="animate-spin text-blue-500" />
                                                    : step.error ? <XCircle size={10} className="text-red-500" />
                                                    : <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />}
                                                <span className="text-secondary">{step.name}</span>
                                                {step.progress?.completed !== undefined && step.progress?.total !== undefined && (
                                                    <span className="text-secondary font-mono">({step.progress.completed}/{step.progress.total})</span>
                                                )}
                                                {step.error && <span className="text-red-500 text-[10px] italic">{step.error.reasons?.[0] || ''}</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    const RefreshButton = () => (
        <div className="flex justify-end mb-2">
            <button onClick={fetchRelatedObjects} title="Refresh" className="text-secondary hover:text-main p-1 rounded hover:bg-app transition-colors">
                <RefreshCw size={16} />
            </button>
        </div>
    );

    const renderMappingsTab = () => (
        <div className="space-y-6">
            <RefreshButton />
            {/* Network Map */}
            <div>
                <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2 flex items-center">
                    <Network size={16} className="mr-2" /> Network Map
                    <span className="ml-2 font-normal font-mono text-xs">({plan.spec?.map?.network?.name})</span>
                    <span className="ml-auto">{networkMap && (isMapReady(networkMap)
                        ? <span className="text-xs text-green-600 flex items-center"><CheckCircle2 size={12} className="mr-1" />Ready</span>
                        : <span className="text-xs text-red-600 flex items-center"><XCircle size={12} className="mr-1" />Not Ready</span>
                    )}</span>
                </h3>
                {networkMap ? (
                    <div className="space-y-2">
                        {(networkMap.spec?.map || []).map((entry, i) => (
                            <div key={i} className="flex items-center text-sm p-2 bg-app rounded border gap-2">
                                <div className="flex-1 font-mono text-xs">
                                    <div className="text-main">{entry.source?.name || entry.source?.id}</div>
                                    {entry.source?.name && entry.source?.id && <div className="text-secondary">{entry.source.id}</div>}
                                </div>
                                <ArrowRight size={14} className="text-secondary flex-shrink-0" />
                                <div className="flex-1 font-mono text-xs">
                                    {entry.destination?.type === 'pod'
                                        ? <span className="text-secondary italic">pod network</span>
                                        : <div>
                                            <span className="text-main">{entry.destination?.namespace}/{entry.destination?.name}</span>
                                            <div className="text-secondary">{entry.destination?.type}</div>
                                          </div>}
                                </div>
                            </div>
                        ))}
                        {(!networkMap.spec?.map || networkMap.spec.map.length === 0) && <p className="text-sm text-secondary italic">No entries.</p>}
                        {networkMap.status?.conditions && (
                            <div className="mt-2 p-2 bg-card rounded border">
                                <p className="text-[10px] font-bold text-secondary uppercase mb-1">NetworkMap Conditions</p>
                                {renderConditionsList(networkMap.status.conditions)}
                            </div>
                        )}
                    </div>
                ) : <p className="text-sm text-secondary italic">Loading...</p>}
            </div>
            {/* Storage Map */}
            <div>
                <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2 flex items-center">
                    <HardDrive size={16} className="mr-2" /> Storage Map
                    <span className="ml-2 font-normal font-mono text-xs">({plan.spec?.map?.storage?.name})</span>
                    <span className="ml-auto">{storageMap && (isMapReady(storageMap)
                        ? <span className="text-xs text-green-600 flex items-center"><CheckCircle2 size={12} className="mr-1" />Ready</span>
                        : <span className="text-xs text-red-600 flex items-center"><XCircle size={12} className="mr-1" />Not Ready</span>
                    )}</span>
                </h3>
                {storageMap ? (
                    <div className="space-y-2">
                        {(storageMap.spec?.map || []).map((entry, i) => {
                            const resolved = storageMap.status?.references?.find(r => r.id === entry.source?.id);
                            return (
                                <div key={i} className="flex items-center text-sm p-2 bg-app rounded border gap-2">
                                    <div className="flex-1 font-mono text-xs">
                                        <div className="text-main">{resolved?.name || entry.source?.name || entry.source?.id}</div>
                                        {entry.source?.id && <div className="text-secondary">{entry.source.id}</div>}
                                    </div>
                                    <ArrowRight size={14} className="text-secondary flex-shrink-0" />
                                    <div className="flex-1 font-mono text-xs">
                                        <span className="text-main">{entry.destination?.storageClass || 'N/A'}</span>
                                        {entry.destination?.volumeMode && <span className="text-secondary ml-2">[{entry.destination.volumeMode}]</span>}
                                        {entry.destination?.accessMode && <span className="text-secondary ml-1">({entry.destination.accessMode})</span>}
                                    </div>
                                </div>
                            );
                        })}
                        {(!storageMap.spec?.map || storageMap.spec.map.length === 0) && <p className="text-sm text-secondary italic">No entries.</p>}
                        {storageMap.status?.conditions && (
                            <div className="mt-2 p-2 bg-card rounded border">
                                <p className="text-[10px] font-bold text-secondary uppercase mb-1">StorageMap Conditions</p>
                                {renderConditionsList(storageMap.status.conditions)}
                            </div>
                        )}
                    </div>
                ) : <p className="text-sm text-secondary italic">Loading...</p>}
            </div>
            {/* Provider */}
            {provider && (
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2 flex items-center">
                        <Server size={16} className="mr-2" /> Source Provider
                        <span className="ml-2 font-normal font-mono text-xs">({plan.spec?.provider?.source?.name})</span>
                        <span className="ml-auto">{isMapReady(provider)
                            ? <span className="text-xs text-green-600 flex items-center"><CheckCircle2 size={12} className="mr-1" />Ready</span>
                            : <span className="text-xs text-red-600 flex items-center"><XCircle size={12} className="mr-1" />Not Ready</span>
                        }</span>
                    </h3>
                    <div className="p-3 bg-app rounded-md border text-sm">
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                            <span className="text-secondary">URL:</span>
                            <span className="text-main font-mono text-xs break-all">{provider.spec?.url}</span>
                            <span className="text-secondary">Type:</span>
                            <span className="text-main">{provider.spec?.type || 'vsphere'}</span>
                            {provider.spec?.username && <><span className="text-secondary">User:</span><span className="text-main font-mono text-xs">{provider.spec.username}</span></>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderMigrationTab = () => {
        if (!migration) {
            return <div><RefreshButton /><p className="text-sm text-secondary italic py-4">No migration has been started for this plan. Use "Run Migration" to begin.</p></div>;
        }
        const migVms = migration.status?.vms || [];
        const migConditions = migration.status?.conditions || [];
        const succeeded = migConditions.find(c => c.type === 'Succeeded')?.status === 'True';
        const running = migConditions.find(c => c.type === 'Running')?.status === 'True';
        const failed = migConditions.find(c => c.type === 'Failed')?.status === 'True';
        const overallStatus = succeeded ? 'Succeeded' : failed ? 'Failed' : running ? 'Running' : 'Pending';
        const statusColors = { Succeeded: 'bg-green-100 text-green-800', Failed: 'bg-red-100 text-red-800', Running: 'bg-blue-100 text-blue-800', Pending: 'bg-app text-main' };
        const vmPhaseBadge = (phase) => {
            const colors = phase === 'Completed' ? 'bg-green-100 text-green-800' : phase === 'Running' ? 'bg-blue-100 text-blue-800' : (phase === 'Failed' || phase === 'Error') ? 'bg-red-100 text-red-800' : 'bg-app text-main';
            return <span className={`text-xs px-2 py-0.5 rounded-full ${colors}`}>{phase}</span>;
        };

        // Aggregate errors across VMs
        const vmErrors = migVms.filter(vm => vm.pipeline?.some(s => s.error)).map(vm => ({
            name: vm.name || vm.id,
            errors: vm.pipeline.filter(s => s.error).map(s => ({ step: s.name, reason: s.error.reasons?.[0] || 'Unknown error' })),
        }));

        return (
            <div className="space-y-4">
                <RefreshButton />
                {/* Status Summary */}
                <div className="flex items-center gap-3 p-3 bg-app rounded-md border">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusColors[overallStatus]}`}>
                        {running && <Loader size={14} className="animate-spin mr-1.5" />}
                        {succeeded && <CheckCircle2 size={14} className="mr-1.5" />}
                        {failed && <XCircle size={14} className="mr-1.5" />}
                        {overallStatus}
                    </span>
                    <span className="text-main font-mono text-xs">{migration.metadata?.name}</span>
                    {failed && (
                        <button
                            onClick={async () => {
                                if (!window.confirm('Delete the failed migration and start a new one?')) return;
                                try {
                                    const ns = plan.metadata.namespace;
                                    const name = plan.metadata.name;
                                    const delRes = await fetch(`/api/v1/forklift/plans/${ns}/${name}/migration`, { method: 'DELETE' });
                                    if (!delRes.ok) {
                                        const err = await delRes.json();
                                        throw new Error(err.error || 'Failed to delete migration');
                                    }
                                    const runRes = await fetch(`/api/v1/forklift/plans/${ns}/${name}/run`, { method: 'POST' });
                                    if (!runRes.ok) {
                                        const err = await runRes.json();
                                        throw new Error(err.error || 'Failed to create migration');
                                    }
                                    setMigration(null);
                                    fetchRelatedObjects();
                                } catch (err) {
                                    alert(`Error retrying migration: ${err.message}`);
                                }
                            }}
                            className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                            title="Delete the failed migration and start a new one"
                        >
                            <RotateCcw size={12} className="mr-1" /> Retry
                        </button>
                    )}
                    {migration.status?.phase && <span className="text-secondary text-xs ml-auto">Phase: {migration.status.phase}</span>}
                </div>

                {/* Migration Metadata */}
                <div className="p-3 bg-app rounded-md border text-sm">
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                        <span className="text-secondary">Created:</span>
                        <span className="text-main text-xs">{formatDate(migration.metadata?.creationTimestamp)}</span>
                        <span className="text-secondary">Started:</span>
                        <span className="text-main text-xs">{migration.status?.started ? formatDate(migration.status.started) : 'N/A'}</span>
                        <span className="text-secondary">Completed:</span>
                        <span className="text-main text-xs">{migration.status?.completed ? formatDate(migration.status.completed) : running ? 'In progress' : 'N/A'}</span>
                        <span className="text-secondary">Duration:</span>
                        <span className="text-main text-xs">
                            {migration.status?.started
                                ? migration.status?.completed
                                    ? formatDuration(migration.status.started, migration.status.completed)
                                    : `${formatDuration(migration.status.started)} (elapsed)`
                                : 'N/A'}
                        </span>
                    </div>
                </div>

                {/* Error Summary */}
                {vmErrors.length > 0 && (
                    <div className="p-3 bg-red-50 rounded-md border border-red-200 text-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle size={14} className="text-red-600" />
                            <span className="font-medium text-red-800">{vmErrors.length} VM(s) with errors</span>
                        </div>
                        <div className="space-y-1 ml-5">
                            {vmErrors.map((vm, i) => (
                                <div key={i}>
                                    {vm.errors.map((err, j) => (
                                        <div key={j} className="text-red-700 text-xs">
                                            <span className="font-medium">{vm.name}</span>: {err.reason} <span className="text-red-500 italic">(step: {err.step})</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {renderConditionsList(migConditions, 'No migration conditions yet.')}

                {/* VM Progress */}
                {migVms.length > 0 && (
                    <div>
                        <h4 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">VM Progress</h4>
                        {migVms.map((vm, i) => {
                            const formatProgress = (progress, annotations) => {
                                const unit = annotations?.unit || '';
                                const completed = progress?.completed || 0;
                                const total = progress?.total || 0;
                                if (unit === 'MB' && total > 0) {
                                    const fmtSize = (mb) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
                                    return `${fmtSize(completed)} / ${fmtSize(total)}`;
                                }
                                return `${completed}/${total}`;
                            };
                            const pct = (progress) => progress?.total ? (progress.completed / progress.total * 100) : 0;
                            return (
                            <div key={i} className="mb-3 p-3 bg-app rounded border">
                                <div className="flex items-center mb-2">
                                    <HardDrive size={14} className="mr-2 text-secondary" />
                                    <span className="text-main font-medium text-sm">{vm.name || vm.id}</span>
                                    <span className="text-xs text-secondary ml-2 font-mono">({vm.id})</span>
                                    {(vm.newName || vm.targetName) && (vm.newName || vm.targetName) !== vm.name && (
                                        <span className="text-xs text-secondary ml-2">→ {vm.newName || vm.targetName}</span>
                                    )}
                                    {vm.phase && <span className="ml-auto">{vmPhaseBadge(vm.phase)}</span>}
                                </div>
                                <div className="text-[10px] text-secondary ml-6 mb-1 flex flex-wrap gap-x-3">
                                    {vm.started && <span>Started: {formatDate(vm.started)}</span>}
                                    {vm.completed && <span>Completed: {formatDate(vm.completed)}</span>}
                                    {vm.started && <span>Duration: {vm.completed ? formatDuration(vm.started, vm.completed) : `${formatDuration(vm.started)} (elapsed)`}</span>}
                                    {vm.restorePowerState && <span>Power after migration: {vm.restorePowerState}</span>}
                                </div>
                                {vm.pipeline && (
                                    <div className="space-y-2 ml-6">
                                        {vm.pipeline.map((step, j) => (
                                            <div key={j} className="text-xs">
                                                <div className="flex items-center gap-2">
                                                    {step.phase === 'Completed' ? <CheckCircle2 size={11} className="text-green-500" />
                                                        : step.phase === 'Running' ? <Loader size={11} className="animate-spin text-blue-500" />
                                                        : step.error ? <XCircle size={11} className="text-red-500" />
                                                        : <div className="w-[11px] h-[11px] rounded-full border border-gray-300" />}
                                                    <span className="font-medium text-main">{step.name}</span>
                                                    {step.description && <span className="text-secondary hidden md:inline">- {step.description}</span>}
                                                    {step.phase && <span className="ml-auto text-secondary">{step.phase}</span>}
                                                </div>
                                                {step.progress && (step.progress.total > 0) && (
                                                    <div className="ml-5 mt-0.5">
                                                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                                                            <div className={`h-1.5 rounded-full transition-all ${step.phase === 'Completed' ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct(step.progress)}%` }} />
                                                        </div>
                                                        <span className="text-[10px] text-secondary">{formatProgress(step.progress, step.annotations)}</span>
                                                        {step.started && (
                                                            <span className="text-[10px] text-secondary ml-2">
                                                                {step.completed ? formatDuration(step.started, step.completed) : `${formatDuration(step.started)} elapsed`}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {/* Per-task breakdown (e.g. individual disks) */}
                                                {step.tasks && step.tasks.length > 0 && (
                                                    <div className="ml-5 mt-1 space-y-1 border-l-2 border-gray-200 pl-3">
                                                        {step.tasks.map((task, k) => (
                                                            <div key={k} className="text-[10px]">
                                                                <div className="flex items-center gap-1.5">
                                                                    {task.phase === 'Completed' ? <CheckCircle2 size={9} className="text-green-500 shrink-0" />
                                                                        : task.phase === 'Running' ? <Loader size={9} className="animate-spin text-blue-500 shrink-0" />
                                                                        : task.error ? <XCircle size={9} className="text-red-500 shrink-0" />
                                                                        : <div className="w-[9px] h-[9px] rounded-full border border-gray-300 shrink-0" />}
                                                                    <span className="text-main font-mono truncate" title={task.name}>{task.name}</span>
                                                                    {task.phase && <span className="ml-auto text-secondary shrink-0">{task.phase}</span>}
                                                                </div>
                                                                {task.progress && task.progress.total > 0 && (
                                                                    <div className="ml-3 mt-0.5">
                                                                        <div className="w-full bg-gray-200 rounded-full h-1">
                                                                            <div className={`h-1 rounded-full transition-all ${task.phase === 'Completed' ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct(task.progress)}%` }} />
                                                                        </div>
                                                                        <span className="text-secondary">{formatProgress(task.progress, task.annotations)}</span>
                                                                    </div>
                                                                )}
                                                                {task.reason && <div className="ml-3 text-secondary italic">{task.reason}</div>}
                                                                {task.error && (
                                                                    <div className="ml-3 text-red-500">{task.error.reasons?.map((r, l) => <div key={l}>{r}</div>)}</div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {step.error && (
                                                    <div className="ml-5 mt-0.5 text-red-500 text-[10px]">
                                                        {step.error.reasons?.map((r, k) => <div key={k}>{r}</div>)}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const renderConditionsTab = () => (
        <div className="space-y-6">
            <RefreshButton />
            <div>
                <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">Plan Conditions</h3>
                {renderConditionsList(plan.status?.conditions, 'No plan conditions reported.')}
            </div>
            {networkMap && (
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">NetworkMap Conditions ({plan.spec?.map?.network?.name})</h3>
                    {renderConditionsList(networkMap.status?.conditions, 'No conditions.')}
                </div>
            )}
            {storageMap && (
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">StorageMap Conditions ({plan.spec?.map?.storage?.name})</h3>
                    {renderConditionsList(storageMap.status?.conditions, 'No conditions.')}
                </div>
            )}
            {migration && (
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">Migration Conditions ({migration.metadata?.name})</h3>
                    {renderConditionsList(migration.status?.conditions, 'No conditions.')}
                </div>
            )}
            {provider && (
                <div>
                    <h3 className="text-sm font-bold text-secondary uppercase tracking-wider mb-2">Provider Conditions ({plan.spec?.provider?.source?.name})</h3>
                    {renderConditionsList(provider.status?.conditions, 'No conditions.')}
                </div>
            )}
        </div>
    );

    const yamlObjects = [
        { key: 'plan', label: 'Plan' },
        { key: 'networkmap', label: 'NetworkMap' },
        { key: 'storagemap', label: 'StorageMap' },
        { key: 'migration', label: 'Migration' },
        { key: 'provider', label: 'Provider' },
    ];

    const renderDebugTab = () => (
        <div>
            <div className="flex items-center space-x-4 mb-3 border-b pb-2">
                <button onClick={() => { setDebugMode('logs'); if (!logs) fetchLogs(); }}
                    className={`text-sm font-medium pb-1 ${debugMode === 'logs' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-secondary hover:text-main'}`}>
                    Logs
                </button>
                <button onClick={() => { setDebugMode('yaml'); if (!yamlContent) fetchYaml(yamlObject); }}
                    className={`text-sm font-medium pb-1 ${debugMode === 'yaml' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-secondary hover:text-main'}`}>
                    YAML
                </button>
                <div className="flex items-center space-x-4 ml-auto">
                    <div className="flex items-center text-xs space-x-2">
                        <button onClick={() => setFontSize(Math.max(6, fontSize - 1))} className="text-secondary hover:text-main font-bold px-1.5 bg-app rounded border hover:bg-gray-200">-A</button>
                        <span className="text-secondary font-mono w-8 text-center">{fontSize}px</span>
                        <button onClick={() => setFontSize(Math.min(24, fontSize + 1))} className="text-secondary hover:text-main font-bold px-1.5 bg-app rounded border hover:bg-gray-200">+A</button>
                    </div>
                    {debugMode === 'logs' && <>
                        <label className="flex items-center text-xs text-secondary opacity-70 cursor-pointer">
                            <input type="checkbox" checked={followLogs} onChange={e => setFollowLogs(e.target.checked)} className="mr-1 h-3 w-3" /> Follow
                        </label>
                        <label className="flex items-center text-xs text-secondary opacity-70 cursor-pointer">
                            <input type="checkbox" checked={onlyRelevantLogs} onChange={e => { setOnlyRelevantLogs(e.target.checked); fetchLogs(!e.target.checked, errorsOnlyLogs, false); }} className="mr-1 h-3 w-3" /> Only relevant
                        </label>
                        <label className="flex items-center text-xs text-secondary opacity-70 cursor-pointer">
                            <input type="checkbox" checked={errorsOnlyLogs} onChange={e => { setErrorsOnlyLogs(e.target.checked); fetchLogs(!onlyRelevantLogs, e.target.checked, false); }} className="mr-1 h-3 w-3" /> Errors only
                        </label>
                        <button onClick={() => fetchLogs(!onlyRelevantLogs, errorsOnlyLogs, false)} className="text-secondary hover:text-main" title="Refresh logs"><RefreshCw size={14} /></button>
                    </>}
                </div>
            </div>
            {debugMode === 'yaml' && (
                <div className="flex items-center space-x-1 mb-2">
                    {yamlObjects.map(obj => (
                        <button key={obj.key}
                            onClick={() => { setYamlObject(obj.key); fetchYaml(obj.key); }}
                            className={`px-3 py-1 text-xs font-medium rounded-t-md transition-colors ${yamlObject === obj.key
                                ? 'bg-gray-800 text-white border border-gray-600 border-b-0'
                                : 'bg-app text-secondary hover:text-main border border-main'}`}>
                            {obj.label}
                        </button>
                    ))}
                    <button onClick={() => fetchYaml(yamlObject)} className="ml-2 text-secondary hover:text-main" title="Refresh YAML"><RefreshCw size={14} /></button>
                </div>
            )}
            <div className="p-4 border rounded-md bg-gray-900 text-white font-mono max-h-96 overflow-y-auto shadow-inner group relative" style={{ fontSize: `${fontSize}px` }}>
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100">
                    <DownloadButton text={debugMode === 'logs' ? logs : yamlContent} filename={debugMode === 'logs' ? `${plan.metadata.name}-logs.txt` : `${plan.metadata.name}-${yamlObject}.yaml`} />
                    <CopyButton text={debugMode === 'logs' ? logs : yamlContent} />
                </div>
                {isLoadingDebug ? (
                    <div className="flex items-center space-x-3 p-4">
                        <Loader className="animate-spin text-blue-400" size={18} />
                        <span className="text-secondary opacity-70">Loading...</span>
                    </div>
                ) : (
                    <>
                        <pre className="whitespace-pre-wrap leading-relaxed">{debugMode === 'logs' ? logs : yamlContent}</pre>
                        <div ref={logsEndRef} />
                    </>
                )}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-card rounded-lg shadow-xl w-[850px] max-w-[95vw] min-h-[50vh] flex flex-col max-h-[95vh] resize overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-semibold text-main">{plan.metadata.name}</h2>
                        <ForkliftStatusBadge conditions={plan.status?.conditions} />
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200"><X size={20} /></button>
                </div>
                {/* Tab bar */}
                <div className="flex space-x-1 px-4 pt-2 border-b border-main bg-app">
                    {detailTabs.map(tab => (
                        <button key={tab.key} onClick={() => handleTabChange(tab.key)}
                            className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-md ${activeTab === tab.key
                                ? 'bg-card border border-main border-b-0 text-blue-600 -mb-px'
                                : 'text-secondary hover:text-main hover:bg-card/50'}`}>
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                    {activeTab === 'overview' && renderOverviewTab()}
                    {activeTab === 'mappings' && renderMappingsTab()}
                    {activeTab === 'migration' && renderMigrationTab()}
                    {activeTab === 'conditions' && renderConditionsTab()}
                    {activeTab === 'debug' && renderDebugTab()}
                </div>
                <div className="p-4 border-t bg-app flex justify-between items-center rounded-b-lg">
                    {status === 'Ready' && (
                        <button onClick={() => onRunMigration(plan)} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md flex items-center">
                            <Play size={16} className="mr-2" /> Run Migration
                        </button>
                    )}
                    <div className="flex-grow" />
                    <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-md font-semibold transition-colors">Close</button>
                </div>
            </div>
        </div>
    );
};

const ForkliftUnavailable = ({ message, namespace, onChangeNamespace, onRetry }) => {
    const [editNs, setEditNs] = useState(namespace || 'forklift');
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle size={48} className="text-yellow-500 mb-4" />
            <h3 className="text-lg font-semibold text-main mb-2">Forklift Unavailable</h3>
            <p className="text-secondary text-sm max-w-md mb-4">{message || 'Forklift host Provider not found. Install and configure Forklift to use this feature.'}</p>
            <div className="flex items-center space-x-2 mt-2">
                <label className="text-sm text-secondary">Namespace:</label>
                <input
                    type="text"
                    value={editNs}
                    onChange={e => setEditNs(e.target.value)}
                    className="form-input text-sm w-48"
                    placeholder="e.g. forklift"
                />
                <button
                    onClick={() => { onChangeNamespace(editNs); onRetry(editNs); }}
                    className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold py-1.5 px-4 rounded-md"
                >
                    Retry
                </button>
            </div>
        </div>
    );
};

const SubTab = ({ tabs, activeTab, onTabChange }) => (
    <div className="flex space-x-1 mb-4 border-b border-main">
        {tabs.map(tab => (
            <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-md ${activeTab === tab.key
                    ? 'bg-card border border-main border-b-0 text-blue-600 -mb-px'
                    : 'text-secondary hover:text-main hover:bg-app'
                    }`}
            >
                {tab.label}
            </button>
        ))}
    </div>
);

export default function App() {
    const [expandedPlans, setExpandedPlans] = useState(new Set());
    const [selectedDisks, setSelectedDisks] = useState({}); // planUid -> diskIndex
    const [theme, setTheme] = useState(localStorage.getItem('vm-import-theme') || 'light');

    useEffect(() => {
        document.body.className = `theme-${theme}`;
        localStorage.setItem('vm-import-theme', theme);
    }, [theme]);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [page, setPage] = useState('plans');
    const [plans, setPlans] = useState([]);
    const [sources, setSources] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const toggleExpand = (uid) => {
        setExpandedPlans(prev => {
            const next = new Set(prev);
            if (next.has(uid)) {
                next.delete(uid);
            } else {
                next.add(uid);
            }
            return next;
        });
    };
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [selectedSource, setSelectedSource] = useState(null);
    const [planToDelete, setPlanToDelete] = useState(null);
    const [sourceToEdit, setSourceToEdit] = useState(null);
    const [sourceToDelete, setSourceToDelete] = useState(null);
    const [showSourceWizard, setShowSourceWizard] = useState(false);
    const [refreshInterval, setRefreshInterval] = useState(10);
    const [ovaSources, setOvaSources] = useState([]);
    const [showOvaSourceWizard, setShowOvaSourceWizard] = useState(false);
    const [ovaSourceToEdit, setOvaSourceToEdit] = useState(null);
    const [ovaSourceToDelete, setOvaSourceToDelete] = useState(null);
    const [selectedOvaSource, setSelectedOvaSource] = useState(null);

    // Sorting State
    const [plansSort, setPlansSort] = useState({ key: 'metadata.creationTimestamp', direction: 'desc' });
    const [sourcesSort, setSourcesSort] = useState({ key: 'metadata.creationTimestamp', direction: 'desc' });
    const [ovaSourcesSort, setOvaSourcesSort] = useState({ key: 'metadata.creationTimestamp', direction: 'desc' });

    const handleSort = (setter) => (key) => {
        setter(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const sortData = (data, sortConfig) => {
        if (!sortConfig.key) return data;
        return [...data].sort((a, b) => {
            const aVal = getNestedValue(a, sortConfig.key);
            const bVal = getNestedValue(b, sortConfig.key);
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const sortedPlans = useMemo(() => sortData(plans, plansSort), [plans, plansSort]);
    const sortedSources = useMemo(() => sortData(sources, sourcesSort), [sources, sourcesSort]);
    const sortedOvaSources = useMemo(() => sortData(ovaSources, ovaSourcesSort), [ovaSources, ovaSourcesSort]);

    // NEW: Capability State
    const [capabilities, setCapabilities] = useState({ harvesterVersion: '', hasAdvancedPower: false });

    // NEW: Fetch Capabilities on Mount
    useEffect(() => {
        fetch('/api/v1/capabilities')
            .then(res => res.json())
            .then(data => {
                console.log("Cluster Capabilities:", data);
                setCapabilities(data);
            })
            .catch(err => console.error("Failed to fetch capabilities:", err));
    }, []);

    // --- Forklift State ---
    const [forkliftAvailable, setForkliftAvailable] = useState(null); // null = loading, true/false
    const [forkliftMessage, setForkliftMessage] = useState('');
    const [forkliftNamespace, setForkliftNamespace] = useState('forklift');
    const [plansSubTab, setPlansSubTab] = useState('vmic');
    const [sourcesSubTab, setSourcesSubTab] = useState('vmic');
    const [ovaSourcesSubTab, setOvaSourcesSubTab] = useState('vmic');
    const [forkliftProviders, setForkliftProviders] = useState([]);
    const [forkliftPlans, setForkliftPlans] = useState([]);
    const [showForkliftProviderWizard, setShowForkliftProviderWizard] = useState(false);
    const [forkliftWizardDefaultType, setForkliftWizardDefaultType] = useState('vsphere');
    const [forkliftProviderToEdit, setForkliftProviderToEdit] = useState(null);
    const [forkliftProviderToDelete, setForkliftProviderToDelete] = useState(null);
    const [selectedForkliftProvider, setSelectedForkliftProvider] = useState(null);
    const [forkliftProviderReturnPage, setForkliftProviderReturnPage] = useState('sources');
    const [selectedForkliftPlan, setSelectedForkliftPlan] = useState(null);
    const [forkliftPlanToDelete, setForkliftPlanToDelete] = useState(null);
    const [forkliftProvidersSort, setForkliftProvidersSort] = useState({ key: 'metadata.creationTimestamp', direction: 'desc' });
    const [forkliftPlansSort, setForkliftPlansSort] = useState({ key: 'metadata.creationTimestamp', direction: 'desc' });

    const sortedForkliftProviders = useMemo(() => sortData(forkliftProviders, forkliftProvidersSort), [forkliftProviders, forkliftProvidersSort]);
    const sortedForkliftVsphereProviders = useMemo(() => sortedForkliftProviders.filter(p => p.spec?.type !== 'ova'), [sortedForkliftProviders]);
    const sortedForkliftOvaProviders = useMemo(() => sortedForkliftProviders.filter(p => p.spec?.type === 'ova'), [sortedForkliftProviders]);
    const sortedForkliftPlans = useMemo(() => sortData(forkliftPlans, forkliftPlansSort), [forkliftPlans, forkliftPlansSort]);

    const checkForkliftAvailability = useCallback((ns) => {
        const checkNs = ns || forkliftNamespace;
        setForkliftAvailable(null);
        fetch(`/api/v1/forklift/availability?namespace=${checkNs}`)
            .then(res => res.json())
            .then(data => {
                setForkliftAvailable(data.available);
                setForkliftMessage(data.message || '');
                if (data.defaultNamespace) setForkliftNamespace(data.defaultNamespace);
            })
            .catch(err => {
                console.error("Failed to check Forklift availability:", err);
                setForkliftAvailable(false);
                setForkliftMessage("Failed to check Forklift availability.");
            });
    }, [forkliftNamespace]);

    // Check Forklift availability on mount
    useEffect(() => {
        checkForkliftAvailability();
    }, [checkForkliftAvailability]);

    const fetchForkliftProviders = async () => {
        try {
            const response = await fetch('/api/v1/forklift/providers');
            if (!response.ok) throw new Error("Failed to fetch Forklift providers");
            const data = await response.json();
            setForkliftProviders(data || []);
        } catch (err) {
            console.error("Failed to fetch Forklift providers:", err);
        }
    };

    const fetchForkliftPlans = async () => {
        try {
            const response = await fetch('/api/v1/forklift/plans');
            if (!response.ok) throw new Error("Failed to fetch Forklift plans");
            const data = await response.json();
            setForkliftPlans(data || []);
        } catch (err) {
            console.error("Failed to fetch Forklift plans:", err);
        }
    };

    // Fetch Forklift data when available
    useEffect(() => {
        if (forkliftAvailable) {
            fetchForkliftProviders();
            fetchForkliftPlans();
        }
    }, [forkliftAvailable]);

    const handleSaveForkliftProvider = async (payload, isEdit) => {
        const url = isEdit ? `/api/v1/forklift/providers/${payload.namespace}/${payload.name}` : '/api/v1/forklift/providers';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Failed to ${isEdit ? 'update' : 'create'} Forklift provider`);
            }
            fetchForkliftProviders();
            setShowForkliftProviderWizard(false);
            setForkliftProviderToEdit(null);
        } catch (err) {
            console.error("Failed to save Forklift provider:", err);
            alert(`Error saving Forklift provider: ${err.message}`);
        }
    };

    const handleDeleteForkliftProvider = async () => {
        if (!forkliftProviderToDelete) return;
        try {
            await fetch(`/api/v1/forklift/providers/${forkliftProviderToDelete.metadata.namespace}/${forkliftProviderToDelete.metadata.name}`, { method: 'DELETE' });
            fetchForkliftProviders();
            setForkliftProviderToDelete(null);
        } catch (err) {
            console.error("Failed to delete Forklift provider:", err);
        }
    };

    const handleEditForkliftProvider = async (provider) => {
        try {
            const response = await fetch(`/api/v1/forklift/providers/${provider.metadata.namespace}/${provider.metadata.name}`);
            if (!response.ok) throw new Error("Failed to fetch Forklift provider details");
            const data = await response.json();
            setForkliftProviderToEdit(data);
            setShowForkliftProviderWizard(true);
        } catch (err) {
            console.error("Failed to fetch Forklift provider details:", err);
            alert(`Error: ${err.message}`);
        }
    };

    const handleDeleteForkliftPlan = async () => {
        if (!forkliftPlanToDelete) return;
        try {
            await fetch(`/api/v1/forklift/plans/${forkliftPlanToDelete.metadata.namespace}/${forkliftPlanToDelete.metadata.name}`, { method: 'DELETE' });
            fetchForkliftPlans();
            setForkliftPlanToDelete(null);
        } catch (err) {
            console.error("Failed to delete Forklift plan:", err);
        }
    };

    const handleRunForkliftMigration = async (plan) => {
        const ns = plan.metadata.namespace;
        const name = plan.metadata.name;
        try {
            // Check if a migration already exists for this plan
            const statusRes = await fetch(`/api/v1/forklift/plans/${ns}/${name}/migration`);
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                if (statusData.metadata && statusData.metadata.name) {
                    // A migration CR already exists
                    if (!window.confirm(
                        `A migration "${statusData.metadata.name}" already exists for plan "${name}".\n\n` +
                        `Do you want to delete the existing migration and start a new one?`
                    )) return;

                    // Delete the existing migration
                    const delRes = await fetch(`/api/v1/forklift/plans/${ns}/${name}/migration`, { method: 'DELETE' });
                    if (!delRes.ok) {
                        const errData = await delRes.json();
                        throw new Error(errData.error || "Failed to delete existing migration");
                    }
                } else {
                    // No existing migration — confirm normally
                    if (!window.confirm(`Start migration for plan "${name}"? This will create a Migration CR.`)) return;
                }
            }

            // Create the new migration
            const response = await fetch(`/api/v1/forklift/plans/${ns}/${name}/run`, { method: 'POST' });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to start migration");
            }
            alert("Migration started successfully!");
            fetchForkliftPlans();
        } catch (err) {
            console.error("Failed to start migration:", err);
            alert(`Error starting migration: ${err.message}`);
        }
    };

    const fetchPlans = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/v1/plans');
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to fetch plans");
            }
            const data = await response.json();
            setPlans(data || []);
        } catch (err) {
            console.error("Failed to fetch plans:", err);
            // alert(`Error fetching plans: ${err.message}`);
            setPlans([]); // Ensure plans is an array on error
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSources = async () => {
        try {
            const response = await fetch('/api/v1/harvester/vmwaresources');
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to fetch sources");
            }
            const data = await response.json();
            setSources(data || []);
        } catch (err) {
            console.error("Failed to fetch sources:", err);
            // alert(`Error fetching sources: ${err.message}`);
        }
    };

    const fetchOvaSources = async () => {
        try {
            const response = await fetch('/api/v1/harvester/ovasources');
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to fetch OVA sources");
            }
            const data = await response.json();
            setOvaSources(data || []);
        } catch (err) {
            console.error("Failed to fetch OVA sources:", err);
            // alert(`Error fetching OVA sources: ${err.message}`);
        }
    };

    useEffect(() => {
        fetchPlans();
        fetchSources();
        fetchOvaSources();
        const intervalId = setInterval(() => {
            // Refresh if autoRefresh is enabled
            if (autoRefresh) {
                fetchPlans();
                if (forkliftAvailable) {
                    fetchForkliftPlans();
                    fetchForkliftProviders();
                }
            }
        }, refreshInterval * 1000);
        return () => clearInterval(intervalId);
    }, [refreshInterval, expandedPlans, autoRefresh, forkliftAvailable]);

    const handleCreatePlan = async (planPayload) => {
        try {
            const response = await fetch('/api/v1/plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(planPayload),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to create plan");
            }
            await response.json();
            fetchPlans(); // Refresh the list
            setPage('plans');
        } catch (err) {
            console.error("Failed to create plan:", err);
            alert(`Error creating plan: ${err.message}`);
        }
    };

    const handleDeletePlan = async () => {
        if (!planToDelete) return;
        try {
            await fetch(`/api/v1/plans/${planToDelete.metadata.namespace}/${planToDelete.metadata.name}`, {
                method: 'DELETE',
            });
            fetchPlans(); // Refresh the list
            setPlanToDelete(null); // Close the modal
        } catch (err) {
            console.error("Failed to delete plan:", err);
        }
    };

    const handleRunPlan = async (plan) => {
        if (!window.confirm(`Run migration plan "${plan.metadata.name}" now?`)) return;
        try {
            const response = await fetch(`/api/v1/plans/${plan.metadata.namespace}/${plan.metadata.name}/run`, {
                method: 'POST',
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to run plan');
            }
            fetchPlans();
        } catch (err) {
            console.error("Failed to run plan:", err);
            alert(`Error running plan: ${err.message}`);
        }
    };

    const handleSaveSource = async (payload, isEdit) => {
        const url = isEdit ? `/api/v1/harvester/vmwaresources/${payload.namespace}/${payload.name}` : '/api/v1/harvester/vmwaresources';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Failed to ${isEdit ? 'update' : 'create'} source`);
            }
            fetchSources();
            setShowSourceWizard(false);
            setSourceToEdit(null);
        } catch (err) {
            console.error(`Failed to save source:`, err);
            alert(`Error saving source: ${err.message}`);
        }
    };

    const handleDeleteSource = async () => {
        if (!sourceToDelete) return;
        try {
            await fetch(`/api/v1/harvester/vmwaresources/${sourceToDelete.metadata.namespace}/${sourceToDelete.metadata.name}`, {
                method: 'DELETE',
            });
            fetchSources();
            setSourceToDelete(null);
        } catch (err) {
            console.error("Failed to delete source:", err);
        }
    };

    const handleSaveOvaSource = async (payload, isEdit) => {
        const url = isEdit ? `/api/v1/harvester/ovasources/${payload.namespace}/${payload.name}` : '/api/v1/harvester/ovasources';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Failed to ${isEdit ? 'update' : 'create'} OVA source`);
            }
            fetchOvaSources();
            setShowOvaSourceWizard(false);
            setOvaSourceToEdit(null);
        } catch (err) {
            console.error(`Failed to save OVA source:`, err);
            alert(`Error saving OVA source: ${err.message}`);
        }
    };

    const handleDeleteOvaSource = async () => {
        if (!ovaSourceToDelete) return;
        try {
            await fetch(`/api/v1/harvester/ovasources/${ovaSourceToDelete.metadata.namespace}/${ovaSourceToDelete.metadata.name}`, {
                method: 'DELETE',
            });
            fetchOvaSources();
            setOvaSourceToDelete(null);
        } catch (err) {
            console.error("Failed to delete OVA source:", err);
        }
    };

    const handleViewDetails = (plan) => {
        const detailedPlan = {
            ...plan,
            name: plan.metadata.name,
            // Mock data for VM spec if it's missing in the list view return
            vms: [{
                name: plan.spec.virtualMachineName,
                status: getPlanStatus(plan),
                progress: 0,
                cpu: plan.status?.cpu || 'N/A',
                memoryMB: plan.status?.memoryMB || 0,
                diskSizeGB: plan.status?.diskImportStatus ? Math.round(plan.status.diskImportStatus.reduce((acc, d) => acc + (d.diskSize || 0), 0) / (1024 * 1024 * 1024)) : 'N/A',
            }]
        };
        setSelectedPlan(detailedPlan);
        setPage('planDetails');
    };

    const handleEditSource = async (source) => {
        try {
            const response = await fetch(`/api/v1/harvester/vmwaresources/${source.metadata.namespace}/${source.metadata.name}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to fetch source details");
            }
            const data = await response.json();
            setSourceToEdit(data);
            setShowSourceWizard(true);
        } catch (err) {
            console.error("Failed to fetch source details:", err);
            alert(`Error fetching source details: ${err.message}`);
        }
    };

    const handleEditOvaSource = async (source) => {
        try {
            const response = await fetch(`/api/v1/harvester/ovasources/${source.metadata.namespace}/${source.metadata.name}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to fetch OVA source details");
            }
            const data = await response.json();
            setOvaSourceToEdit(data);
            setShowOvaSourceWizard(true);
        } catch (err) {
            console.error("Failed to fetch OVA source details:", err);
            alert(`Error fetching OVA source details: ${err.message}`);
        }
    };

    const renderPage = () => {
        switch (page) {
            case 'createPlan':
                return <CreatePlanWizard onCancel={() => setPage('plans')} onCreatePlan={handleCreatePlan} capabilities={capabilities} forkliftAvailable={forkliftAvailable} forkliftNamespace={forkliftNamespace} />;
            case 'planDetails':
                return <PlanDetails plan={selectedPlan} onClose={() => setPage('plans')} />;
            case 'forkliftPlanDetails':
                return selectedForkliftPlan ? <ForkliftPlanDetails plan={selectedForkliftPlan} onClose={() => { setSelectedForkliftPlan(null); setPage('plans'); }} onRunMigration={handleRunForkliftMigration} forkliftNamespace={forkliftNamespace} /> : null;
            case 'sourceDetails':
                return <SourceDetails source={selectedSource} onClose={() => setPage('sources')} />;
            case 'sources':
                return (
                    <div className="w-full">
                        <SubTab
                            tabs={[{ key: 'vmic', label: 'VM Import Controller' }, { key: 'forklift', label: 'Forklift' }]}
                            activeTab={sourcesSubTab}
                            onTabChange={setSourcesSubTab}
                        />
                        {sourcesSubTab === 'vmic' ? (
                            <>
                                <Header title="vCenter Sources" onButtonClick={() => { setSourceToEdit(null); setShowSourceWizard(true); }} />
                                <SourcesTable
                                    sources={sortedSources}
                                    onEdit={handleEditSource}
                                    onDelete={setSourceToDelete}
                                    onViewDetails={(source) => { setSelectedSource(source); setPage('sourceDetails'); }}
                                    onExplore={(source) => { setSelectedSource(source); setPage('exploreSource'); }}
                                    sortConfig={sourcesSort}
                                    onSort={handleSort(setSourcesSort)}
                                />
                            </>
                        ) : (
                            forkliftAvailable ? (
                                <>
                                    <Header title="Forklift vSphere Providers" onButtonClick={() => { setForkliftProviderToEdit(null); setForkliftWizardDefaultType('vsphere'); setShowForkliftProviderWizard(true); }} />
                                    <ForkliftProvidersTable
                                        providers={sortedForkliftVsphereProviders}
                                        onEdit={handleEditForkliftProvider}
                                        onDelete={setForkliftProviderToDelete}
                                        onViewDetails={(provider) => { setSelectedForkliftProvider(provider); setForkliftProviderReturnPage('sources'); setPage('forkliftProviderDetails'); }}
                                        onExplore={(provider) => { setSelectedSource({ metadata: provider.metadata, _forkliftProvider: true }); setPage('exploreForkliftSource'); }}
                                        sortConfig={forkliftProvidersSort}
                                        onSort={handleSort(setForkliftProvidersSort)}
                                    />
                                    <div className="flex justify-end items-center mt-4 space-x-2">
                                        <button onClick={fetchForkliftProviders} className="text-blue-500 hover:text-blue-700"><RefreshCw size={20} /></button>
                                    </div>
                                </>
                            ) : <ForkliftUnavailable message={forkliftMessage} namespace={forkliftNamespace} onChangeNamespace={setForkliftNamespace} onRetry={checkForkliftAvailability} />
                        )}
                    </div>
                );
            case 'forkliftProviderDetails':
                return selectedForkliftProvider ? <ForkliftProviderDetails provider={selectedForkliftProvider} onClose={() => { setSelectedForkliftProvider(null); setPage(forkliftProviderReturnPage); }} /> : null;
            case 'exploreForkliftSource':
                return <SourceExplorer source={selectedSource} onClose={() => setPage('sources')} inventoryApiBase="/api/v1/forklift/inventory" />;
            case 'exploreSource':
                return <SourceExplorer source={selectedSource} onClose={() => setPage('sources')} />;
            case 'ovaSourceDetails':
                return <OvaSourceDetails source={selectedOvaSource} onClose={() => setPage('ovaSources')} />;
            case 'ovaSources':
                return (
                    <div className="w-full">
                        <SubTab
                            tabs={[{ key: 'vmic', label: 'VM Import Controller' }, { key: 'forklift', label: 'Forklift' }]}
                            activeTab={ovaSourcesSubTab}
                            onTabChange={setOvaSourcesSubTab}
                        />
                        {ovaSourcesSubTab === 'vmic' ? (
                            <>
                                <Header title="OVA Sources" onButtonClick={() => { setOvaSourceToEdit(null); setShowOvaSourceWizard(true); }} />
                                <OvaSourcesTable sources={sortedOvaSources} onEdit={handleEditOvaSource} onDelete={setOvaSourceToDelete} onViewDetails={(source) => { setSelectedOvaSource(source); setPage('ovaSourceDetails'); }} sortConfig={ovaSourcesSort} onSort={handleSort(setOvaSourcesSort)} />
                                <div className="flex justify-end items-center mt-4 space-x-2">
                                    <button onClick={fetchOvaSources} className="text-blue-500 hover:text-blue-700"><RefreshCw size={20} /></button>
                                    <input type="number" value={refreshInterval} onChange={e => setRefreshInterval(e.target.value)} className="w-20 form-input text-sm" />
                                    <span className="text-sm text-secondary">seconds</span>
                                </div>
                            </>
                        ) : (
                            forkliftAvailable ? (
                                <>
                                    <Header title="Forklift OVA Providers" onButtonClick={() => { setForkliftProviderToEdit(null); setForkliftWizardDefaultType('ova'); setShowForkliftProviderWizard(true); }} />
                                    <ForkliftProvidersTable
                                        providers={sortedForkliftOvaProviders}
                                        onEdit={handleEditForkliftProvider}
                                        onDelete={setForkliftProviderToDelete}
                                        onViewDetails={(provider) => { setSelectedForkliftProvider(provider); setForkliftProviderReturnPage('ovaSources'); setPage('forkliftProviderDetails'); }}
                                        onExplore={(provider) => { setSelectedSource({ metadata: provider.metadata, _forkliftProvider: true }); setPage('exploreForkliftSource'); }}
                                        sortConfig={forkliftProvidersSort}
                                        onSort={handleSort(setForkliftProvidersSort)}
                                    />
                                    <div className="flex justify-end items-center mt-4 space-x-2">
                                        <button onClick={fetchForkliftProviders} className="text-blue-500 hover:text-blue-700"><RefreshCw size={20} /></button>
                                    </div>
                                </>
                            ) : <ForkliftUnavailable message={forkliftMessage} namespace={forkliftNamespace} onChangeNamespace={setForkliftNamespace} onRetry={checkForkliftAvailability} />
                        )}
                    </div>
                );
            case 'about':
                return <AboutPage />;
            case 'plans':
            default:
                return (
                    <div className="w-full">
                        <SubTab
                            tabs={[{ key: 'vmic', label: 'VM Import Controller' }, { key: 'forklift', label: 'Forklift' }]}
                            activeTab={plansSubTab}
                            onTabChange={setPlansSubTab}
                        />
                        {plansSubTab === 'vmic' ? (
                            <>
                                <Header title="VM Migration Plans" onButtonClick={() => setPage('createPlan')} />
                                {isLoading ? <p>Loading plans...</p> : <ResourceTable
                                    plans={sortedPlans}
                                    onViewDetails={handleViewDetails}
                                    onDelete={setPlanToDelete}
                                    onRun={handleRunPlan}
                                    sortConfig={plansSort}
                                    onSort={handleSort(setPlansSort)}
                                    expandedPlans={expandedPlans}
                                    toggleExpand={toggleExpand}
                                    selectedDisks={selectedDisks}
                                    setSelectedDisks={setSelectedDisks}
                                />}
                            </>
                        ) : (
                            forkliftAvailable ? (
                                <>
                                    <Header title="Forklift Migration Plans" onButtonClick={() => setPage('createPlan')} />
                                    <ForkliftPlansTable
                                        plans={sortedForkliftPlans}
                                        onDelete={setForkliftPlanToDelete}
                                        onViewDetails={(plan) => { setSelectedForkliftPlan(plan); setPage('forkliftPlanDetails'); }}
                                        sortConfig={forkliftPlansSort}
                                        onSort={handleSort(setForkliftPlansSort)}
                                        expandedPlans={expandedPlans}
                                        toggleExpand={toggleExpand}
                                        onRunMigration={handleRunForkliftMigration}
                                    />
                                </>
                            ) : <ForkliftUnavailable message={forkliftMessage} namespace={forkliftNamespace} onChangeNamespace={setForkliftNamespace} onRetry={checkForkliftAvailability} />
                        )}
                        <div className="flex justify-end items-center mt-4 space-x-6">
                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="autoRefreshPlans"
                                    checked={autoRefresh}
                                    onChange={e => setAutoRefresh(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 border-main rounded focus:ring-blue-500"
                                />
                                <label htmlFor="autoRefreshPlans" className="text-sm font-medium text-main cursor-pointer">Auto-refresh</label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <button onClick={() => { fetchPlans(); if (forkliftAvailable) fetchForkliftPlans(); }} className="text-blue-500 hover:text-blue-700" title="Refresh Now"><RefreshCw size={20} /></button>
                                <div className="flex items-center space-x-1">
                                    <input type="number" value={refreshInterval} onChange={e => setRefreshInterval(e.target.value)} className="w-16 form-input text-sm border rounded px-1" />
                                    <span className="text-xs text-secondary">s</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="min-h-screen p-2 md:p-4 font-sans transition-colors duration-300">
            <div className="flex justify-between items-center mb-6 border-b pb-2">
                <nav className="flex space-x-4">
                    <div className="flex items-center mr-6 pr-6 border-r border-main">
                        <img
                            src="https://harvesterhci.io/img/logo_horizontal.svg"
                            alt="Harvester"
                            className="h-8 transition-opacity"
                        />
                    </div>
                    <button onClick={() => setPage('plans')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'plans' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-secondary hover:text-main'}`}><List size={18} className="mr-2" /> Migration Plans</button>
                    <button onClick={() => setPage('sources')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'sources' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-secondary hover:text-main'}`}><Server size={18} className="mr-2" /> vCenter Sources</button>
                    <button onClick={() => setPage('ovaSources')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'ovaSources' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-secondary hover:text-main'}`}><Package size={18} className="mr-2" /> OVA Sources</button>
                    <button onClick={() => setPage('about')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'about' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-secondary hover:text-main'}`}><Info size={18} className="mr-2" /> About</button>
                </nav>

                <div className="flex items-center space-x-2 relative group">
                    <div className="flex items-center bg-card border border-main rounded-md px-3 py-1.5 shadow-sm">
                        <Palette size={16} className="mr-2 text-blue-500" />
                        <select
                            value={theme}
                            onChange={(e) => setTheme(e.target.value)}
                            className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer text-main"
                        >
                            <option value="light">Light</option>
                            <option value="suse">SUSE Green</option>
                            <option value="dark">Dark</option>
                        </select>
                    </div>
                </div>
            </div>
            <div className="w-full">
                {renderPage()}
            </div>

            {showSourceWizard && <SourceWizard onCancel={() => { setShowSourceWizard(false); setSourceToEdit(null); }} onSave={handleSaveSource} source={sourceToEdit} />}
            {showOvaSourceWizard && <OvaSourceWizard onCancel={() => { setShowOvaSourceWizard(false); setOvaSourceToEdit(null); }} onSave={handleSaveOvaSource} source={ovaSourceToEdit} />}

            {planToDelete && (
                <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-card rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the plan "{planToDelete.metadata.name}"?</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setPlanToDelete(null)} className="btn-secondary">Cancel</button>
                            <button onClick={handleDeletePlan} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            {sourceToDelete && (
                <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-card rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the vCenter source "{sourceToDelete.metadata.name}"? This will also delete the associated credentials secret.</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setSourceToDelete(null)} className="btn-secondary">Cancel</button>
                            <button onClick={handleDeleteSource} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            {ovaSourceToDelete && (
                <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-card rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the OVA source "{ovaSourceToDelete.metadata.name}"? This will also delete the associated credentials secret.</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setOvaSourceToDelete(null)} className="btn-secondary">Cancel</button>
                            <button onClick={handleDeleteOvaSource} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Forklift Modals */}
            {showForkliftProviderWizard && <ForkliftProviderWizard onCancel={() => { setShowForkliftProviderWizard(false); setForkliftProviderToEdit(null); }} onSave={handleSaveForkliftProvider} source={forkliftProviderToEdit} defaultNamespace={forkliftNamespace} defaultProviderType={forkliftWizardDefaultType} />}
            {forkliftProviderToDelete && (
                <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-card rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the Forklift provider "{forkliftProviderToDelete.metadata.name}"? This will also delete the associated credentials secret.</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setForkliftProviderToDelete(null)} className="btn-secondary">Cancel</button>
                            <button onClick={handleDeleteForkliftProvider} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            {forkliftPlanToDelete && (
                <div className="fixed inset-0 bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-card rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the Forklift plan "{forkliftPlanToDelete.metadata.name}"? This will also delete the associated NetworkMap and StorageMap.</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setForkliftPlanToDelete(null)} className="btn-secondary">Cancel</button>
                            <button onClick={handleDeleteForkliftPlan} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}