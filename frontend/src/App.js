import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, ChevronRight, Server, Folder, Cloud, HardDrive, ArrowRight, X, Loader, CheckCircle, Clock } from 'lucide-react';

// --- Helper Functions ---
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const formatSeconds = (seconds) => {
  if (seconds === Infinity || isNaN(seconds)) return '...';
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

const ResourceTable = ({ plans, onViewDetails }) => (
    <div className="bg-white shadow-md rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
                <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VMs</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target Namespace</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                {plans.map(plan => (
                    <tr key={plan.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{plan.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.status}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.vms}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.target}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button onClick={() => onViewDetails(plan)} className="text-blue-600 hover:text-blue-800">View Details</button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const PlanDetails = ({ plan, onClose }) => {
    const [localPlan, setLocalPlan] = useState(plan);
    const [startTime] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => {
            setLocalPlan(currentPlan => {
                if (currentPlan.status !== 'In Progress') return currentPlan;

                const updatedVms = currentPlan.vms.map(vm => {
                    if (vm.status === 'Completed' || vm.status === 'Failed') return vm;

                    let newProgress = vm.progress + Math.random() * 5; // Slower, more realistic progress
                    let newStatus = 'Copying Disks';

                    if (newProgress >= 100) {
                        newProgress = 100;
                        newStatus = 'Completed';
                    }
                    return { ...vm, progress: newProgress, status: newStatus };
                });

                const allDone = updatedVms.every(vm => vm.status === 'Completed' || vm.status === 'Failed');
                const newPlanStatus = allDone ? 'Completed' : 'In Progress';

                return { ...currentPlan, vms: updatedVms, status: newPlanStatus };
            });
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const overallStats = useMemo(() => {
        if (!localPlan.vms || localPlan.vms.length === 0) return {
            progress: 0, totalSize: 0, transferred: 0, speed: 0, eta: 0
        };

        const totalSize = localPlan.vms.reduce((acc, vm) => acc + (vm.diskSizeGB || 0), 0) * 1024 * 1024 * 1024;
        const transferred = localPlan.vms.reduce((acc, vm) => acc + (vm.diskSizeGB || 0) * (vm.progress / 100), 0) * 1024 * 1024 * 1024;
        const progress = (transferred / totalSize) * 100;

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const speed = elapsedSeconds > 0 ? transferred / elapsedSeconds : 0;
        
        const remainingBytes = totalSize - transferred;
        const eta = speed > 0 ? remainingBytes / speed : Infinity;

        return { progress, totalSize, transferred, speed, eta };
    }, [localPlan.vms, startTime]);

    const getStatusIcon = (status) => {
        switch (status) {
            case 'Completed': return <CheckCircle className="text-green-500" />;
            case 'In Progress':
            case 'Copying Disks': return <Loader className="animate-spin text-blue-500" />;
            case 'Scheduled':
            case 'Queued': return <Clock className="text-gray-500" />;
            default: return null;
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold text-gray-800">{localPlan.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Overall Progress</h3>
                        <div className="w-full bg-gray-200 rounded-full h-4">
                            <div className="bg-blue-600 h-4 rounded-full transition-all duration-500" style={{ width: `${overallStats.progress}%` }}></div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2 text-gray-600">
                            <span>{formatBytes(overallStats.transferred)} / {formatBytes(overallStats.totalSize)}</span>
                            <span className="font-medium">{formatBytes(overallStats.speed)}/s</span>
                            <span className="flex items-center gap-2">{getStatusIcon(localPlan.status)} {localPlan.status}</span>
                            <span>ETA: {formatSeconds(overallStats.eta)}</span>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">VM Migration Status</h3>
                        <div className="space-y-3">
                            {localPlan.vms.map((vm, index) => (
                                <div key={index} className="p-3 bg-gray-50 rounded-md border">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-medium text-gray-800">{vm.name}</span>
                                        <span className="text-sm flex items-center gap-2 text-gray-600">
                                            {getStatusIcon(vm.status)}
                                            {vm.status}
                                        </span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                                        <div className="bg-green-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${vm.progress || 0}%` }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
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
    case 'cluster': return <Server className="w-5 h-5 text-purple-500" />;
    case 'folder': return <Folder className="w-5 h-5 text-yellow-600" />;
    case 'vm': return <HardDrive className="w-5 h-5 text-gray-600" />;
    default: return null;
  }
};

const InventoryTree = ({ node, selectedVms, onVmToggle, level = 0 }) => {
    const [isOpen, setIsOpen] = useState(level < 2);
    const isParent = node.children && node.children.length > 0;

    return (
        <div style={{ paddingLeft: level > 0 ? '20px' : '0px' }}>
            <div
                className="flex items-center p-2 rounded-md hover:bg-gray-100 cursor-pointer"
                onClick={() => isParent && setIsOpen(!isOpen)}
            >
                {isParent && <ChevronRight size={16} className={`mr-1 transform transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                <VmIcon type={node.type} />
                <span className="ml-2 text-gray-800">{node.name}</span>
                {node.type === 'vm' && (
                    <input
                        type="checkbox"
                        className="ml-auto form-checkbox h-4 w-4 text-blue-600 transition duration-150 ease-in-out"
                        checked={selectedVms.some(vm => vm.name === node.name)}
                        onChange={(e) => { e.stopPropagation(); onVmToggle(node); }}
                    />
                )}
            </div>
            {isOpen && isParent && (
                <div>
                    {node.children.map((child, index) => (
                        <InventoryTree key={index} node={child} selectedVms={selectedVms} onVmToggle={onVmToggle} level={level + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

const CreatePlanWizard = ({ onCancel, onCreatePlan }) => {
    const [step, setStep] = useState(1);
    const [vcenterInventory, setVcenterInventory] = useState(null);
    const [selectedVms, setSelectedVms] = useState([]);
    const [planName, setPlanName] = useState('');
    const [targetNamespace, setTargetNamespace] = useState('');
    const [newNamespace, setNewNamespace] = useState('');
    const [namespaces, setNamespaces] = useState([]);
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

    useEffect(() => {
        fetch('/api/v1/vcenter/connect', { method: 'POST' })
            .then(res => res.json())
            .then(data => setVcenterInventory(data))
            .catch(err => console.error("Failed to fetch vCenter inventory:", err));
        
        fetchNamespaces();
        fetch('/api/v1/harvester/vlanconfigs').then(res => res.json()).then(data => setHarvesterNetworks(data.map(net => net.metadata.name)));
        fetch('/api/v1/harvester/storageclasses').then(res => res.json()).then(data => setStorageClasses(data.map(sc => sc.metadata.name)));
    }, []);

    const handleVmToggle = (vm) => {
        setSelectedVms(prev =>
          prev.some(v => v.name === vm.name)
            ? prev.filter(v => v.name !== vm.name)
            : [...prev, vm]
        );
    };

    const sourceNetworks = React.useMemo(() => {
        const nets = new Set();
        selectedVms.forEach(vm => vm.networks.forEach(net => nets.add(net)));
        return Array.from(nets);
    }, [selectedVms]);

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
                const err = await response.text();
                throw new Error(`Failed to create namespace: ${err}`);
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
        const totalSizeGB = selectedVms.reduce((acc, vm) => acc + (vm.diskSizeGB || 0), 0);
        onCreatePlan({ name: planName, vms: selectedVms.length, status: 'Scheduled', target: finalTargetNamespace, totalSizeGB });
    };

    const renderStepContent = () => {
        switch (step) {
            case 1:
                return (
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Select Virtual Machines</h3>
                        <p className="text-sm text-gray-600 mb-4">Select the VMs from your vCenter inventory to migrate.</p>
                        <div className="border border-gray-200 rounded-md p-2 h-96 overflow-y-auto bg-white">
                            {vcenterInventory ? <InventoryTree node={vcenterInventory} selectedVms={selectedVms} onVmToggle={handleVmToggle} /> : <p>Loading inventory...</p>}
                        </div>
                    </div>
                );
            case 2:
                return (
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Configuration</h3>
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
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Network Mapping</h3>
                        <p className="text-sm text-gray-600 mb-4">Map source networks to target Harvester networks.</p>
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
                    {step < 3 && <button onClick={() => setStep(s => s + 1)} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md">Next</button>}
                    {step === 3 && <button onClick={handleSubmit} className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md">Create</button>}
                </div>
            </div>
        </div>
    );
};

export default function App() {
    const [page, setPage] = useState('dashboard');
    const [plans, setPlans] = useState([]);
    const [selectedPlan, setSelectedPlan] = useState(null);

    useEffect(() => {
        fetch('/api/v1/plans')
            .then(res => res.json())
            .then(data => setPlans(data))
            .catch(err => console.error("Failed to fetch plans:", err));
    }, []);

    const handleCreatePlan = (newPlan) => {
        setPlans(prev => [...prev, { ...newPlan, id: `plan-${Date.now()}` }]);
        setPage('dashboard');
    };

    const handleViewDetails = (plan) => {
        // In a real app, this would fetch from /api/v1/plans/{plan.id}
        const detailedPlan = {
            ...plan,
            vms: Array.from({ length: plan.vms }, (_, i) => ({
                name: `vm-in-plan-${plan.id}-${i+1}`,
                status: plan.status === 'Completed' ? 'Completed' : 'Queued',
                progress: plan.status === 'Completed' ? 100 : 0,
                diskSizeGB: (plan.totalSizeGB || 50) / plan.vms,
            }))
        };
        setSelectedPlan(detailedPlan);
        setPage('planDetails');
    };

    const renderPage = () => {
        switch (page) {
            case 'create':
                return <CreatePlanWizard onCancel={() => setPage('dashboard')} onCreatePlan={handleCreatePlan} />;
            case 'planDetails':
                return <PlanDetails plan={selectedPlan} onClose={() => setPage('dashboard')} />;
            case 'dashboard':
            default:
                return (
                    <div>
                        <Header title="VM Migration Plans" onButtonClick={() => setPage('create')} />
                        <ResourceTable plans={plans} onViewDetails={handleViewDetails} />
                    </div>
                );
        }
    };

    return (
        <div className="bg-gray-100 min-h-screen p-8 font-sans">
            <div className="max-w-7xl mx-auto">
                {renderPage()}
            </div>
        </div>
    );
}