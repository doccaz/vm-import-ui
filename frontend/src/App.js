import React, { useState, useEffect, useMemo } from 'react';
import { Plus, ChevronRight, Server, Folder, Cloud, HardDrive, ArrowRight, X, Loader, CheckCircle, Clock, Cpu, MemoryStick, Trash2, Edit, AlertTriangle, RefreshCw, List, Package, Info } from 'lucide-react';

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
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor(seconds % (3600 * 24) / 3600);
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
                                <button onClick={() => { }} title="Edit" className="text-gray-600 hover:text-gray-800 cursor-not-allowed"><Edit size={18} /></button>
                                <button onClick={() => onDelete(plan)} title="Delete" className="text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
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

const OvaSourcesTable = ({ sources, onEdit, onDelete, onViewDetails }) => (
    <div className="bg-white shadow-md rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
                <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Namespace</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">URL</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                {sources.length === 0 ? (
                    <tr>
                        <td colSpan="4" className="px-6 py-4 text-center text-sm text-gray-500">No OVA sources found.</td>
                    </tr>
                ) : (
                    sources.map(source => (
                        <tr key={source.metadata.uid} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{source.metadata.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{source.metadata.namespace}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{source.spec.url}</td>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                <div className="p-4 border-b">
                    <h2 className="text-xl font-semibold">{isEditMode ? 'Edit' : 'Create'} OVA Source</h2>
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
                        <label className="block text-sm font-medium text-gray-700">OVA File URL</label>
                        <input type="text" placeholder="http://192.168.0.1:8080/example.ova" value={url} onChange={e => setUrl(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">HTTP Timeout (Seconds)</label>
                        <input type="number" placeholder="Optional. Default is 600" value={httpTimeoutSeconds} onChange={e => setHttpTimeoutSeconds(e.target.value)} className="mt-1 block w-full form-input" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Username</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full form-input" placeholder="Optional" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full form-input" placeholder={isEditMode ? "Leave blank to keep existing password" : "Optional"} />
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
                                <span>{plan.vms?.[0]?.cpu || 'N/A'} vCPU(s)</span>
                            </div>
                            <div className="flex items-center">
                                <MemoryStick size={16} className="mr-2 text-gray-600" />
                                <span>{formatBytes((plan.vms?.[0]?.memoryMB || 0) * 1024 * 1024, 0)} Memory</span>
                            </div>
                            <div className="flex items-center">
                                <HardDrive size={16} className="mr-2 text-gray-600" />
                                <span>{plan.vms?.[0]?.diskSizeGB || 'N/A'} GB Storage</span>
                            </div>
                            {/* Added Folder Display */}
                            <div className="flex items-center">
                                <Folder size={16} className="mr-2 text-gray-600" />
                                <span>{plan.spec?.folder || '/'}</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Plan Summary</h3>
                        <div className="p-3 bg-gray-50 rounded-md border text-sm space-y-1">
                            <p><strong>VM Name:</strong> {plan.spec?.virtualMachineName || 'N/A'}</p>
                            <p><strong>Source:</strong> {plan.spec?.sourceCluster?.namespace}/{plan.spec?.sourceCluster?.name || 'N/A'}</p>
                            <p><strong>Storage Class:</strong> {plan.spec?.storageClass || 'N/A'}</p>

                            {/* Added Advanced Options Display */}
                            {plan.spec?.forcePowerOff && <p><strong>Force Power Off:</strong> Yes</p>}
                            {plan.spec?.gracefulShutdownTimeoutSeconds > 0 && <p><strong>Shutdown Timeout:</strong> {plan.spec.gracefulShutdownTimeoutSeconds}s</p>}
                            {plan.spec?.defaultNetworkInterfaceModel && <p><strong>Default Interface:</strong> {plan.spec.defaultNetworkInterfaceModel}</p>}
                            {plan.spec?.skipPreflightChecks && <p><strong>Skip Validation:</strong> Yes</p>}
                            {plan.spec?.defaultDiskBusType && <p><strong>Disk Bus:</strong> {plan.spec.defaultDiskBusType}</p>}
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
                {/* Added Folder Display */}
                <div className="flex items-center">
                    <Folder size={16} className="mr-2 text-gray-600" />
                    <span>{vm.folder || '/'}</span>
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

// --- UPDATED WIZARD COMPONENT ---
const CreatePlanWizard = ({ onCancel, onCreatePlan, capabilities }) => {
    const [step, setStep] = useState(1);
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

    const fetchNetworks = () => {
        fetch('/api/v1/harvester/vlanconfigs').then(res => res.json()).then(data => setHarvesterNetworks(data.map(net => net.metadata.namespace + "/" + net.metadata.name)));
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
    }, []);

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

    const handleSourceChange = async (sourceIdentifier) => {
        setSelectedSource(sourceIdentifier);
        if (!sourceIdentifier) {
            setVcenterInventory(null);
            return;
        }

        if (sourceType === 'ova') {
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

    const sourceNetworks = useMemo(() => {
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

        // Construct the plan object
        const plan = {
            apiVersion: "migration.harvesterhci.io/v1beta1",
            kind: "VirtualMachineImport",
            metadata: {
                name: planName.toLowerCase().replace(/\s+/g, '-'),
                namespace: finalTargetNamespace,
            },
            spec: {
                virtualMachineName: sourceType === 'ova' ? ovaVmName : selectedVm.name,
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
                folder: sourceType === 'ova' ? undefined : selectedVm?.folder,
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
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Select Source & VM</h3>

                        <div className="mb-4 flex items-center space-x-6">
                            <label className="inline-flex items-center">
                                <input type="radio" className="form-radio text-blue-600" name="sourceType" value="vmware" checked={sourceType === 'vmware'} onChange={() => { setSourceType('vmware'); setSelectedSource(''); setSelectedVm(null); }} />
                                <span className="ml-2">VMware vCenter</span>
                            </label>
                            <label className="inline-flex items-center">
                                <input type="radio" className="form-radio text-blue-600" name="sourceType" value="ova" checked={sourceType === 'ova'} onChange={() => { setSourceType('ova'); setSelectedSource(''); setOvaVmName(''); }} />
                                <span className="ml-2">OVA File</span>
                            </label>
                        </div>

                        {sourceType === 'vmware' ? (
                            <div className="space-y-4 p-4 border rounded-md bg-gray-50">
                                <div className="flex items-center">
                                    <label className="block text-sm font-medium text-gray-700 flex-grow">vCenter Source</label>
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
                            <div className="space-y-4 p-4 border rounded-md bg-gray-50">
                                <div className="flex items-center">
                                    <label className="block text-sm font-medium text-gray-700 flex-grow">OVA Source</label>
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
                                    <label className="block text-sm font-medium text-gray-700">Target VM Name</label>
                                    <input type="text" placeholder="e.g. My-Imported-OVA" value={ovaVmName} onChange={e => setOvaVmName(e.target.value)} className="mt-1 block w-full form-input" />
                                </div>
                            </div>
                        )}

                        {sourceType === 'vmware' && isConnecting && <Loader className="animate-spin mt-4" />}
                        {sourceType === 'vmware' && connectionError && <p className="text-sm text-red-600 mt-2">{connectionError}</p>}

                        {sourceType === 'vmware' && vcenterInventory && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                <div className="border border-gray-200 rounded-md p-2 h-96 overflow-y-auto bg-white">
                                    <div className="flex justify-end">
                                        <button onClick={() => handleSourceChange(selectedSource)} className="text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                                    </div>
                                    <InventoryTree node={vcenterInventory} onVmSelect={setSelectedVm} currentlySelectedVm={selectedVm} />
                                </div>
                                <VmDetailsPanel vm={selectedVm} />
                            </div>
                        )}
                        <p className="text-sm text-gray-600 mt-2">
                            {sourceType === 'ova' ? (ovaVmName && selectedSource ? '1 VM configured for import.' : 'Select source and enter VM name.') : (selectedVm ? '1 VM selected for migration.' : '0 VMs selected.')}
                        </p>
                    </div>
                );
            case 2:
                return (
                    <div>
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Configuration</h3>
                            <button onClick={() => { fetchNamespaces(); fetchStorageClasses(); }} className="text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">Define the migration plan details and target resources.</p>

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

                        {/* New Advanced Options Section */}
                        {capabilities.hasAdvancedPower && (
                            <div className="mt-6 border-t pt-4">
                                <h4 className="text-md font-medium text-gray-900 mb-3">Advanced Options</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-md border">
                                    <div className="flex items-center">
                                        <input
                                            id="forcePowerOff"
                                            type="checkbox"
                                            checked={forcePowerOff}
                                            onChange={e => setForcePowerOff(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                        <label htmlFor="forcePowerOff" className="ml-2 block text-sm text-gray-700">
                                            Force Power Off Source VM
                                            <p className="text-xs text-gray-500 mt-0.5">Required if VMware Tools is not installed.</p>
                                        </label>
                                    </div>

                                    {/* NEW: Skip Preflight Checks */}
                                    <div className="flex items-center">
                                        <input
                                            id="skipPreflight"
                                            type="checkbox"
                                            checked={skipPreflight}
                                            onChange={e => setSkipPreflight(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                        <label htmlFor="skipPreflight" className="ml-2 block text-sm text-gray-700">
                                            Skip Preflight Checks
                                            <p className="text-xs text-gray-500 mt-0.5">Bypass validation (use with caution).</p>
                                        </label>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Graceful Shutdown Timeout (Seconds)</label>
                                        <input
                                            type="number"
                                            value={shutdownTimeout}
                                            onChange={e => setShutdownTimeout(e.target.value)}
                                            placeholder="e.g. 300"
                                            className="mt-1 block w-full form-input text-sm"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Default Network Interface Model</label>
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
                                        <label className="block text-sm font-medium text-gray-700">Default Disk Bus Type</label>
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
                                        <p className="text-xs text-gray-500 mt-1">Specify bus type if automatic detection fails.</p>
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
                            <h3 className="text-lg font-medium text-gray-900 mb-2 flex-grow">Network Mapping</h3>
                            <button onClick={fetchNetworks} className="ml-2 text-blue-500 hover:text-blue-700"><RefreshCw size={16} /></button>
                        </div>
                        <p className="text-sm text-gray-600 mb-4">Map source networks to target Harvester networks.</p>
                        {harvesterNetworks.length === 0 ? (
                            <p className="text-sm text-gray-500">No VLANs defined in Harvester.</p>
                        ) : (
                            <div className="space-y-4">
                                {sourceNetworks.map(net => (
                                    <div key={net} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center border-b pb-4 mb-2 last:border-0 last:pb-0">
                                        <div className="md:col-span-4 font-mono text-sm text-gray-800 break-all flex items-center">
                                            <div className="bg-gray-200 text-gray-600 px-2 py-1 rounded text-xs mr-2">Source</div>
                                            {net}
                                        </div>
                                        <div className="md:col-span-1 text-center hidden md:block">
                                            <ArrowRight className="mx-auto text-gray-400" />
                                        </div>
                                        <div className="md:col-span-4">
                                            <select
                                                onChange={e => setNetworkMappings(prev => ({ ...prev, [net]: e.target.value }))}
                                                className="form-select w-full text-sm"
                                            >
                                                <option>Select Harvester Network</option>
                                                {harvesterNetworks.map(hnet => <option key={hnet} value={hnet}>{hnet}</option>)}
                                            </select>
                                        </div>

                                        {capabilities.hasAdvancedPower && (
                                            <div className="md:col-span-3">
                                                <select
                                                    onChange={e => setNetworkModels(prev => ({ ...prev, [net]: e.target.value }))}
                                                    className="form-select w-full text-sm text-gray-600"
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

                            {/* Review Advanced Options */}
                            {capabilities.hasAdvancedPower && (forcePowerOff || shutdownTimeout || defaultModel || skipPreflight || diskBus) && (
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
                                    <li>{selectedVm?.name} <span className="text-gray-500 text-xs">(Folder: {selectedVm?.folder || '/'})</span></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-medium mt-2">Network Mappings:</h4>
                                <ul className="list-disc list-inside pl-4">
                                    {Object.entries(networkMappings).map(([key, value]) => (
                                        <li key={key}>
                                            {key} &rarr; {value}
                                            {capabilities.hasAdvancedPower && networkModels[key] && <span className="text-xs text-gray-500 ml-2">[{networkModels[key]}]</span>}
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
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">
                About VM Import UI
            </h1>

            <img
                src="/logo-stacked-harvester.svg"
                alt="Harvester Logo"
                className="h-32 w-32"
            />
        </div>

        <div className="bg-white shadow-md rounded-lg p-6 relative overflow-hidden">
            <a href="https://github.com/doccaz/vm-import-ui" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub" className="fixed top-0 right-0 z-50">
                <svg width="80" height="80" viewBox="0 0 250 250" style={{ fill: '#151513', color: '#fff', position: 'absolute', top: 0, border: 0, right: 0 }} aria-hidden="true">
                    <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
                    <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style={{ transformOrigin: '130px 106px' }} className="octo-arm"></path>
                    <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" className="octo-body"></path>
                </svg>
            </a>
            <style>{`.github-corner:hover .octo-arm{animation:octocat-wave 560ms ease-in-out}@keyframes octocat-wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-25deg)}40%,80%{transform:rotate(10deg)}}@media (max-width:500px){.github-corner:hover .octo-arm{animation:none}.github-corner .octo-arm{animation:octocat-wave 560ms ease-in-out}}`}</style>

            <h2 className="text-xl font-semibold mb-4 z-10 relative">Harvester VM Import UI</h2>
            <p className="mb-2 z-10 relative"><strong>Version:</strong> 1.1.0</p>
            <p className="mb-2 z-10 relative">This UI provides a user-friendly interface for the Harvester VM Import Controller, allowing users to import virtual machines from a VMware vCenter into a Harvester cluster.</p>
            <p className="mb-6 italic text-sm text-gray-600 z-10 relative mt-2 border-l-4 border-blue-400 pl-3">Based off of an idea by Erico Mendonca (erico.mendonca@suse.com)</p>

            <h3 className="text-lg font-semibold mb-3 z-10 relative">How to Use</h3>
            <div className="space-y-4 z-10 relative text-gray-700">
                <div>
                    <h4 className="font-semibold text-gray-800 flex items-center mb-1"><List size={16} className="mr-1 text-blue-600" /> Migration Plans Tab</h4>
                    <p className="text-sm">
                        This is your primary dashboard for managing imports. Once you have configured a source (vCenter or OVA), click <strong>Create</strong> to launch the Migration Plan Wizard. The wizard will guide you through:
                    </p>
                    <ul className="list-disc list-inside text-sm mt-1 ml-2 space-y-1">
                        <li>Selecting your pre-configured source type (VMware vs. OVA).</li>
                        <li>Choosing the specific Virtual Machine to import (via vCenter inventory tree or by specifying the OVA VM name).</li>
                        <li>Configuring target execution parameters like Namespace and Storage Class.</li>
                        <li>Mapping source networks to Harvester VLANs and specifying advanced interfaces (e.g., virtio, e1000).</li>
                    </ul>
                    <p className="text-sm mt-1">From the dashboard, you can track the live progress, examine the raw YAML configuration, and view backend logs for each migration.</p>
                </div>

                <div>
                    <h4 className="font-semibold text-gray-800 flex items-center mb-1"><Server size={16} className="mr-1 text-blue-600" /> vCenter Sources Tab</h4>
                    <p className="text-sm">
                        Before migrating VMs from VMware, you must register the vCenter instance here. Click <strong>Create</strong> and provide:
                    </p>
                    <ul className="list-disc list-inside text-sm mt-1 ml-2 space-y-1">
                        <li>The vCenter Endpoint URL and Datacenter Name.</li>
                        <li>Credentials (Username/Password), which are securely stored as Kubernetes Secrets.</li>
                    </ul>
                    <p className="text-sm mt-1">You can edit these configurations or delete them (which concurrently deletes the stored credential Secret).</p>
                </div>

                <div>
                    <h4 className="font-semibold text-gray-800 flex items-center mb-1"><Package size={16} className="mr-1 text-blue-600" /> OVA Sources Tab</h4>
                    <p className="text-sm">
                        Use this tab to define HTTP/HTTPS endpoints serving Open Virtual Appliance (.ova) files. Click <strong>Create</strong> to add an OVA source, specifying:
                    </p>
                    <ul className="list-disc list-inside text-sm mt-1 ml-2 space-y-1">
                        <li>The Download URL for the OVA file.</li>
                        <li>An optional HTTP Timeout limit.</li>
                        <li>Optional Username and Password for authenticated endpoints (stored securely).</li>
                    </ul>
                </div>

                <div>
                    <h4 className="font-semibold text-gray-800 flex items-center mb-1"><Info size={16} className="mr-1 text-blue-600" /> About Tab</h4>
                    <p className="text-sm">
                        You are here! This tab provides application versioning, attribution, frontend GitHub links, and basic documentation on how to navigate the utility.
                    </p>
                </div>
            </div>
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
    const [ovaSources, setOvaSources] = useState([]);
    const [showOvaSourceWizard, setShowOvaSourceWizard] = useState(false);
    const [ovaSourceToEdit, setOvaSourceToEdit] = useState(null);
    const [ovaSourceToDelete, setOvaSourceToDelete] = useState(null);
    const [selectedOvaSource, setSelectedOvaSource] = useState(null);

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
                return <CreatePlanWizard onCancel={() => setPage('plans')} onCreatePlan={handleCreatePlan} capabilities={capabilities} />;
            case 'planDetails':
                return <PlanDetails plan={selectedPlan} onClose={() => setPage('plans')} />;
            case 'sourceDetails':
                return <SourceDetails source={selectedSource} onClose={() => setPage('sources')} />;
            case 'sources':
                return (
                    <div>
                        <Header title="vCenter Sources" onButtonClick={() => { setSourceToEdit(null); setShowSourceWizard(true); }} />
                        <SourcesTable sources={sources} onEdit={handleEditSource} onDelete={setSourceToDelete} onViewDetails={(source) => { setSelectedSource(source); setPage('sourceDetails'); }} />
                    </div>
                );
            case 'ovaSourceDetails':
                return <OvaSourceDetails source={selectedOvaSource} onClose={() => setPage('ovaSources')} />;
            case 'ovaSources':
                return (
                    <div>
                        <Header title="OVA Sources" onButtonClick={() => { setOvaSourceToEdit(null); setShowOvaSourceWizard(true); }} />
                        <OvaSourcesTable sources={ovaSources} onEdit={handleEditOvaSource} onDelete={setOvaSourceToDelete} onViewDetails={(source) => { setSelectedOvaSource(source); setPage('ovaSourceDetails'); }} />
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
                            <button onClick={fetchPlans} className="text-blue-500 hover:text-blue-700"><RefreshCw size={20} /></button>
                            <input type="number" value={refreshInterval} onChange={e => setRefreshInterval(e.target.value)} className="w-20 form-input text-sm" />
                            <span className="text-sm text-gray-600">seconds</span>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="bg-gray-100 min-h-screen p-8 font-sans">
            <nav className="mb-6 border-b flex space-x-4">
                <button onClick={() => setPage('plans')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'plans' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}><List size={18} className="mr-2" /> Migration Plans</button>
                <button onClick={() => setPage('sources')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'sources' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}><Server size={18} className="mr-2" /> vCenter Sources</button>
                <button onClick={() => setPage('ovaSources')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'ovaSources' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}><Package size={18} className="mr-2" /> OVA Sources</button>
                <button onClick={() => setPage('about')} className={`px-4 py-2 flex items-center font-medium transition-colors ${page === 'about' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}><Info size={18} className="mr-2" /> About</button>
            </nav>
            <div className="max-w-7xl mx-auto">
                {renderPage()}
            </div>

            {showSourceWizard && <SourceWizard onCancel={() => { setShowSourceWizard(false); setSourceToEdit(null); }} onSave={handleSaveSource} source={sourceToEdit} />}
            {showOvaSourceWizard && <OvaSourceWizard onCancel={() => { setShowOvaSourceWizard(false); setOvaSourceToEdit(null); }} onSave={handleSaveOvaSource} source={ovaSourceToEdit} />}

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
            {ovaSourceToDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6">
                        <h3 className="text-lg font-bold">Confirm Deletion</h3>
                        <p className="my-4">Are you sure you want to delete the OVA source "{ovaSourceToDelete.metadata.name}"? This will also delete the associated credentials secret.</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setOvaSourceToDelete(null)} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">Cancel</button>
                            <button onClick={handleDeleteOvaSource} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}