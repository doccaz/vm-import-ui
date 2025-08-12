import React, { useState, useEffect, useMemo } from 'react';
import { Plus, ChevronRight, Server, Folder, Cloud, HardDrive, ArrowRight, X, Loader, CheckCircle, Clock, Cpu, MemoryStick, Trash2, Edit, AlertTriangle, RefreshCw } from 'lucide-react';

// --- Helper Functions ---
const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const formatSeconds = (seconds) => {
  if (seconds === Infinity || isNaN(seconds) || seconds < 0) return '...';
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

// --- Components ---
const Header = ({ title, onButtonClick }) => (
    <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-semibold text-gray-800">{title}</h1>
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

const ResourceTable = ({ plans, onViewDetails, onDelete }) => (
    <div className="bg-white shadow-md rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
                <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VM Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target Namespace</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Storage Class</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                {plans.length === 0 ? (
                    <tr>
                        <td colSpan="6" className="px-6 py-4 text-center text-sm text-gray-500">No migration plans found.</td>
                    </tr>
                ) : (
                    plans.map(plan => (
                        <tr key={plan.metadata.uid} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{plan.metadata.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getPlanStatus(plan)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.spec.virtualMachineName}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.metadata.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.spec.storageClass}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                <button onClick={() => {}} title="Edit" className="text-gray-600 hover:text-gray-800 cursor-not-allowed"><Edit size={18}/></button>
                                <button onClick={() => onDelete(plan)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18}/></button>
                                <button onClick={() => onViewDetails(plan)} className="text-blue-600 hover:text-blue-800">Details</button>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    </div>
);

const SourcesTable = ({ sources, onEdit, onDelete, onViewDetails }) => (
    <div className="bg-white shadow-md rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
                <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Namespace</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                {sources.length === 0 ? (
                    <tr>
                        <td colSpan="4" className="px-6 py-4 text-center text-sm text-gray-500">No vCenter sources found.</td>
                    </tr>
                ) : (
                    sources.map(source => (
                        <tr key={source.metadata.uid} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{source.metadata.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{source.metadata.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{source.spec.endpoint}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                <button onClick={() => onEdit(source)} title="Edit" className="text-blue-600 hover:text-blue-800"><Edit size={18}/></button>
                                <button onClick={() => onDelete(source)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18}/></button>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                <div className="p-4 border-b">
                    <h2 className="text-xl font-semibold">{isEditMode ? 'Edit' : 'Create'} vCenter Source</h2>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input disabled:bg-gray-200" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Namespace</label>
                        <input type="text" value={namespace} onChange={e => setNamespace(e.target.value)} disabled={isEditMode} className="mt-1 block w-full form-input disabled:bg-gray-200" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">vCenter Endpoint URL</label>
                        <input type="text" placeholder="https://vcenter.your-domain.com/sdk" value={endpoint} onChange={e => setEndpoint(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Datacenter Name</label>
                        <input type="text" value={datacenter} onChange={e => setDatacenter(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Username</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full form-input" placeholder={isEditMode ? "Leave blank to keep existing password" : ""} />
                    </div>
                </div>
                <div className="p-4 border-t flex justify-end space-x-2">
                    <button onClick={onCancel} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold text-gray-800">{source.metadata.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Source Summary</h3>
                        <div className="p-3 bg-gray-50 rounded-md border text-sm space-y-1">
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
                            <div className="mt-2 p-2 border rounded-md bg-gray-900 text-white font-mono text-xs max-h-64 overflow-y-auto">
                                <pre>{isLoadingYaml ? 'Loading...' : yamlContent}</pre>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t bg-gray-50 text-right rounded-b-lg">
                    <button onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-md">Close</button>
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

    const fetchLogs = async () => {
        setIsLoadingDebug(true);
        try {
            const response = await fetch(`/api/v1/plans/${plan.metadata.namespace}/${plan.metadata.name}/logs`);
            const data = await response.text();
            setLogs(data || "No relevant logs found.");
        } catch (err) {
            setLogs("Failed to fetch logs.");
        } finally {
            setIsLoadingDebug(false);
        }
    };
    
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold text-gray-800">{plan.metadata.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">VM Characteristics</h3>
                        <div className="p-3 bg-gray-50 rounded-md border text-sm space-y-2">
                            <div className="flex items-center">
                                <Cpu size={16} className="mr-2 text-gray-600" />
                                <span>{plan.vms[0]?.cpu || 'N/A'} vCPU(s)</span>
                            </div>
                            <div className="flex items-center">
                                <MemoryStick size={16} className="mr-2 text-gray-600" />
                                <span>{formatBytes((plan.vms[0]?.memoryMB || 0) * 1024 * 1024, 0)} Memory</span>
                            </div>
                            <div className="flex items-center">
                                <HardDrive size={16} className="mr-2 text-gray-600" />
                                <span>{plan.vms[0]?.diskSizeGB || 'N/A'} GB Storage</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Plan Summary</h3>
                        <div className="p-3 bg-gray-50 rounded-md border text-sm space-y-1">
                            <p><strong>VM Name:</strong> {plan.spec?.virtualMachineName || 'N/A'}</p>
                            <p><strong>Source:</strong> {plan.spec?.sourceCluster?.namespace}/{plan.spec?.sourceCluster?.name || 'N/A'}</p>
                            <p><strong>Storage Class:</strong> {plan.spec?.storageClass || 'N/A'}</p>
                        </div>
                    </div>
                    <div>
                        <div className="flex space-x-2">
                            <button onClick={() => handleShowDebug('logs')} className="text-sm text-blue-600 hover:underline">
                                {showDebug === 'logs' ? 'Hide' : 'Show'} Debug Logs
                            </button>
                            <button onClick={() => handleShowDebug('yaml')} className="text-sm text-blue-600 hover:underline">
                                {showDebug === 'yaml' ? 'Hide' : 'View'} YAML
                            </button>
                        </div>
                        {showDebug && (
                            <div className="mt-2 p-2 border rounded-md bg-gray-900 text-white font-mono text-xs max-h-48 overflow-y-auto">
                                <pre>{isLoadingDebug ? 'Loading...' : (showDebug === 'logs' ? logs : yamlContent)}</pre>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t bg-gray-50 text-right rounded-b-lg">
                    <button onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-md">Close</button>
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
    case 'VirtualMachine': return <HardDrive className="w-5 h-5 text-gray-600" />;
    default: return null;
  }
};

const InventoryTree = ({ node, onVmSelect, currentlySelectedVm, level = 0 }) => {
    const [isOpen, setIsOpen] = useState(level < 2);
    const isParent = node.children && node.children.length > 0;

    const handleNodeClick = () => {
        if (isParent) {
            setIsOpen(!isOpen);
        } else if (node.type === 'VirtualMachine') {
            onVmSelect(node);
        }
    };

    return (
        <div style={{ paddingLeft: level > 0 ? '20px' : '0px' }}>
            <div
                className={`flex items-center p-2 rounded-md cursor-pointer ${currentlySelectedVm?.name === node.name ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                onClick={handleNodeClick}
            >
                {isParent && <ChevronRight size={16} className={`mr-1 transform transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                <VmIcon type={node.type} />
                <span className="ml-2 text-gray-800">{node.name}</span>
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
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const VmDetailsPanel = ({ vm }) => {
    if (!vm) {
        return (
            <div className="p-4 border rounded-md bg-gray-50 h-full flex items-center justify-center">
                <p className="text-gray-500">Select a VM to see details</p>
            </div>
        );
    }

    return (
        <div className="p-4 border rounded-md bg-gray-50 h-full">
            <h3 className="text-lg font-medium text-gray-900 mb-4">{vm.name}</h3>
            <div className="space-y-3 text-sm">
                <div className="flex items-center">
                    <Cpu size={16} className="mr-2 text-gray-600" />
                    <span>{vm.cpu || 'N/A'} vCPU(s)</span>
                </div>
                <div className="flex items-center">
                    <MemoryStick size={16} className="mr-2 text-gray-600" />
                    <span>{formatBytes((vm.memoryMB || 0) * 1024 * 1024, 0)} Memory</span>
                </div>
                <div className="flex items-center">
                    <HardDrive size={16} className="mr-2 text-gray-600" />
                    <span>{vm.diskSizeGB || 'N/A'} GB Storage</span>
                </div>
                <div>
                    <h4 className="font-medium text-gray-800 mt-4 mb-1">Networks</h4>
                    <ul className="list-disc list-inside pl-2">
                        {(vm.networks || []).map((net, i) => <li key={i}>{net}</li>)}
                    </ul>
                </div>
            </div>
        </div>
    );
};

const CreatePlanWizard = ({ onCancel, onCreatePlan }) => {
    const [step, setStep] = useState(1);
    const [vmwareSources, setVmwareSources] = useState([]);
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
    const [networkMappings, setNetworkMappings] = useState({});
    const [harvesterNetworks, setHarvesterNetworks] = useState([]);
    const [storageClass, setStorageClass] = useState('');
    const [storageClasses, setStorageClasses] = useState([]);

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

    const fetchNetworks = () => {
        fetch('/api/v1/harvester/vlanconfigs').then(res => res.json()).then(data => setHarvesterNetworks(data.map(net => net.metadata.name)));
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
        fetchNamespaces();
        fetchNetworks();
        fetchStorageClasses();
    }, []);

    useEffect(() => {
        fetchVmsInNamespace(targetNamespace);
    }, [targetNamespace]);

    useEffect(() => {
        if (selectedVm && existingVmNames.includes(selectedVm.name)) {
            setVmNameConflict(true);
        } else {
            setVmNameConflict(false);
        }
    }, [selectedVm, existingVmNames]);

    const handleSourceChange = async (sourceIdentifier) => {
        setSelectedSource(sourceIdentifier);
        if (!sourceIdentifier) {
            setVcenterInventory(null);
            return;
        }
        
        const [namespace, name] = sourceIdentifier.split('/');
        setIsConnecting(true);
        setConnectionError('');
        try {
            const response = await fetch(`/api/v1/vcenter/inventory/${namespace}/${name}`);
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

    const sourceNetworks = React.useMemo(() => {
        if (!selectedVm) return [];
        return selectedVm.networks || [];
    }, [selectedVm]);

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
        
        const [sourceNamespace, sourceName] = selectedSource.split('/');
        const plan = {
            apiVersion: "migration.harvesterhci.io/v1beta1",
            kind: "VirtualMachineImport",
            metadata: {
                name: planName.toLowerCase().replace(/\s+/g, '-'),
                namespace: finalTargetNamespace,
            },
            spec: {
                virtualMachineName: selectedVm.name,
                sourceCluster: {
                    name: sourceName,
                    namespace: sourceNamespace,
                    kind: "VmwareSource",
                    apiVersion: "migration.harvesterhci.io/v1beta1",
                },
                storageClass: storageClass,
                networkMapping: Object.entries(networkMappings).map(([key, value]) => ({
                    sourceNetwork: key,
                    destinationNetwork: `${finalTargetNamespace}/${value}`,
                })),
            }
        };

        onCreatePlan(plan);
    };

    const renderStepContent = () => {
        switch (step) {
            case 1:
                return (
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Select vCenter Source & VM</h3>
                        <div className="space-y-4 p-4 border rounded-md bg-gray-50">
                             <div className="flex items-center">
                                <label className="block text-sm font-medium text-gray-700 flex-grow">vCenter Source</label>
                                <button onClick={fetchSources} className="ml-2 text-blue-500 hover:text-blue-700"><RefreshCw size={16}/></button>
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

                        {isConnecting && <Loader className="animate-spin mt-4" />}
                        {connectionError && <p className="text-sm text-red-600 mt-2">{connectionError}</p>}

                        {vcenterInventory && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                <div className="border border-gray-200 rounded-md p-2 h-96 overflow-y-auto bg-white">
                                    <div className="flex justify-end">
                                        <button onClick={() => handleSourceChange(selectedSource)} className="text-blue-500 hover:text-blue-700"><RefreshCw size={16}/></button>
                                    </div>
                                    <InventoryTree node={vcenterInventory} onVmSelect={setSelectedVm} currentlySelectedVm={selectedVm}/>
                                </div>
                                <VmDetailsPanel vm={selectedVm} />
                            </div>
                        )}
                         <p className="text-sm text-gray-600 mt-2">{selectedVm ? '1 VM' : '0 VMs'} selected for migration.</p>
                    </div>
                );
            case 2:
                return (
                    <div>
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Configuration</h3>
                            <button onClick={() => {fetchNamespaces(); fetchStorageClasses();}} className="text-blue-500 hover:text-blue-700"><RefreshCw size={16}/></button>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">Define the migration plan details and target resources.</p>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Plan Name</label>
                                <input type="text" value={planName} onChange={e => setPlanName(e.target.value)} className="mt-1 block w-full form-input" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Target Namespace</label>
                                <select value={targetNamespace} onChange={e => setTargetNamespace(e.target.value)} className="mt-1 block w-full form-select">
                                    <option value="">Select a namespace</option>
                                    {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                                    <option value="create_new">--- Create New Namespace ---</option>
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
                                <label className="block text-sm font-medium text-gray-700">Target Storage Class</label>
                                <select value={storageClass} onChange={e => setStorageClass(e.target.value)} className="mt-1 block w-full form-select">
                                    <option value="">Select a Storage Class</option>
                                    {storageClasses.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                );
            case 3:
                return (
                    <div>
                        <div className="flex items-center">
                            <h3 className="text-lg font-medium text-gray-900 mb-2 flex-grow">Network Mapping</h3>
                            <button onClick={fetchNetworks} className="ml-2 text-blue-500 hover:text-blue-700"><RefreshCw size={16}/></button>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">Map source networks to target Harvester networks.</p>
                        {harvesterNetworks.length === 0 ? (
                            <p className="text-sm text-gray-500">No VLANs defined in Harvester.</p>
                        ) : (
                            <div className="space-y-3">
                                {sourceNetworks.map(net => (
                                    <div key={net} className="grid grid-cols-3 items-center gap-4">
                                        <span className="font-mono text-sm text-gray-800">{net}</span>
                                        <ArrowRight className="mx-auto text-gray-400" />
                                        <select onChange={e => setNetworkMappings(prev => ({...prev, [net]: e.target.value}))} className="form-select">
                                            <option>Select Harvester Network</option>
                                            {harvesterNetworks.map(hnet => <option key={hnet} value={hnet}>{hnet}</option>)}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            case 4:
                return (
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Review Plan</h3>
                        <div className="space-y-4 text-sm">
                            <div><strong>Plan Name:</strong> {planName}</div>
                            <div><strong>Destination VM Name:</strong> {selectedVm.name}</div>
                            <div><strong>Target Namespace:</strong> {targetNamespace === 'create_new' ? `${newNamespace} (new)` : targetNamespace}</div>
                            <div><strong>Storage Class:</strong> {storageClass}</div>
                            <div>
                                <h4 className="font-medium mt-2">VM to Migrate:</h4>
                                <ul className="list-disc list-inside pl-4">
                                    <li>{selectedVm?.name}</li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-medium mt-2">Network Mappings:</h4>
                                <ul className="list-disc list-inside pl-4">
                                    {Object.entries(networkMappings).map(([key, value]) => <li key={key}>{key} &rarr; {value}</li>)}
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
            <div className="bg-white p-6 shadow-md rounded-lg">
                {renderStepContent()}
            </div>
            <div className="mt-6 flex justify-between">
                <button onClick={onCancel} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button>
                <div>
                    {step > 1 && <button onClick={() => setStep(s => s - 1)} className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-md mr-2">Back</button>}
                    {step < 4 && <button onClick={() => setStep(s => s + 1)} disabled={vmNameConflict} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md disabled:opacity-50">Next</button>}
                    {step === 4 && <button onClick={handleSubmit} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md">Create Plan</button>}
                </div>
            </div>
        </div>
    );
};

const AboutPage = () => (
    <div>
        <Header title="About VM Import UI" />
        <div className="bg-white shadow-md rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Harvester VM Import UI</h2>
            <p className="mb-2"><strong>Version:</strong> 0.6.5</p>
            <p className="mb-4">This UI provides a user-friendly interface for the Harvester VM Import Controller, allowing users to import virtual machines from a VMware vCenter into a Harvester cluster.</p>
            
            <h3 className="text-lg font-semibold mb-2">How to Use</h3>
            <ol className="list-decimal list-inside space-y-2">
                <li><strong>vCenter Sources Tab:</strong> Before you can import VMs, you must configure a connection to your vCenter. Use the "Create" button to add a new source, providing your vCenter's endpoint, datacenter name, and credentials.</li>
                <li><strong>Migration Plans Tab:</strong> Once a source is configured, you can create a migration plan. Click "Create", select your vCenter source, and browse the inventory to choose a VM to import.</li>
                <li><strong>Configuration:</strong> Follow the wizard to configure the plan name, target namespace, storage, and network mappings for the new VM.</li>
                <li><strong>Management:</strong> All created plans will appear in the dashboard, where you can run, delete, or view their details and logs.</li>
            </ol>
        </div>
    </div>
);

export default function App() {
    const [page, setPage] = useState('plans'); // 'plans', 'sources', 'about'
    const [plans, setPlans] = useState([]);
    const [sources, setSources] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [selectedSource, setSelectedSource] = useState(null);
    const [planToDelete, setPlanToDelete] = useState(null);
    const [sourceToEdit, setSourceToEdit] = useState(null);
    const [sourceToDelete, setSourceToDelete] = useState(null);
    const [showSourceWizard, setShowSourceWizard] = useState(false);
    const [refreshInterval, setRefreshInterval] = useState(10);

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
            alert(`Error fetching plans: ${err.message}`);
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
            alert(`Error fetching sources: ${err.message}`);
        }
    };

    useEffect(() => {
        fetchPlans();
        fetchSources();
        const intervalId = setInterval(fetchPlans, refreshInterval * 1000);
        return () => clearInterval(intervalId);
    }, [refreshInterval]);

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

    const handleViewDetails = (plan) => {
        const detailedPlan = {
            ...plan,
            name: plan.metadata.name,
            vms: [{
                name: plan.spec.virtualMachineName,
                status: getPlanStatus(plan),
                progress: 0, 
                cpu: 2, 
                memoryMB: 2048,
                diskSizeGB: 50, 
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

    const renderPage = () => {
        switch (page) {
            case 'createPlan':
                return <CreatePlanWizard onCancel={() => setPage('plans')} onCreatePlan={handleCreatePlan} />;
            case 'planDetails':
                return <PlanDetails plan={selectedPlan} onClose={() => setPage('plans')} />;
            case 'sourceDetails':
                return <SourceDetails source={selectedSource} onClose={() => setPage('sources')} />;
            case 'sources':
                return (
                    <div>
                        <Header title="vCenter Sources" onButtonClick={() => { setSourceToEdit(null); setShowSourceWizard(true); }} />
                        <SourcesTable sources={sources} onEdit={handleEditSource} onDelete={setSourceToDelete} onViewDetails={(source) => { setSelectedSource(source); setPage('sourceDetails'); }}/>
                    </div>
                );
            case 'about':
                return <AboutPage />;
            case 'plans':
            default:
                return (
                    <div>
                        <Header title="VM Migration Plans" onButtonClick={() => setPage('createPlan')} />
                        {isLoading ? <p>Loading plans...</p> : <ResourceTable plans={plans} onViewDetails={handleViewDetails} onDelete={setPlanToDelete} />}
                        <div className="flex justify-end items-center mt-4 space-x-2">
                            <button onClick={fetchPlans} className="text-blue-500 hover:text-blue-700"><RefreshCw size={20}/></button>
                            <input type="number" value={refreshInterval} onChange={e => setRefreshInterval(e.target.value)} className="w-20 form-input text-sm" />
                            <span className="text-sm text-gray-600">seconds</span>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="bg-gray-100 min-h-screen p-8 font-sans">
             <nav className="mb-6 border-b">
                <button onClick={() => setPage('plans')} className={`px-4 py-2 ${page === 'plans' ? 'border-b-2 border-blue-500' : ''}`}>Migration Plans</button>
                <button onClick={() => setPage('sources')} className={`px-4 py-2 ${page === 'sources' ? 'border-b-2 border-blue-500' : ''}`}>vCenter Sources</button>
                <button onClick={() => setPage('about')} className={`px-4 py-2 ${page === 'about' ? 'border-b-2 border-blue-500' : ''}`}>About</button>
            </nav>
            <div className="max-w-7xl mx-auto">
                {renderPage()}
            </div>

            {showSourceWizard && <SourceWizard onCancel={() => { setShowSourceWizard(false); setSourceToEdit(null); }} onSave={handleSaveSource} source={sourceToEdit} />}

            {planToDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the plan "{planToDelete.metadata.name}"?</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setPlanToDelete(null)} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button>
                            <button onClick={handleDeletePlan} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            {sourceToDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the vCenter source "{sourceToDelete.metadata.name}"? This will also delete the associated credentials secret.</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setSourceToDelete(null)} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button>
                            <button onClick={handleDeleteSource} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
