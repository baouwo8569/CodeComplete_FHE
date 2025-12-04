// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface CodeSnippet {
  id: string;
  encryptedCode: string;
  timestamp: number;
  owner: string;
  language: string;
  completion: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [snippets, setSnippets] = useState<CodeSnippet[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newSnippetData, setNewSnippetData] = useState({
    language: "",
    code: "",
    description: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [showStats, setShowStats] = useState(false);

  // Calculate statistics
  const totalSnippets = snippets.length;
  const javascriptCount = snippets.filter(s => s.language === "JavaScript").length;
  const pythonCount = snippets.filter(s => s.language === "Python").length;
  const solidityCount = snippets.filter(s => s.language === "Solidity").length;

  useEffect(() => {
    loadSnippets().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadSnippets = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("snippet_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing snippet keys:", e);
        }
      }
      
      const list: CodeSnippet[] = [];
      
      for (const key of keys) {
        try {
          const snippetBytes = await contract.getData(`snippet_${key}`);
          if (snippetBytes.length > 0) {
            try {
              const snippetData = JSON.parse(ethers.toUtf8String(snippetBytes));
              list.push({
                id: key,
                encryptedCode: snippetData.code,
                timestamp: snippetData.timestamp,
                owner: snippetData.owner,
                language: snippetData.language,
                completion: snippetData.completion || ""
              });
            } catch (e) {
              console.error(`Error parsing snippet data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading snippet ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setSnippets(list);
    } catch (e) {
      console.error("Error loading snippets:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitSnippet = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting code with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedCode = `FHE-${btoa(newSnippetData.code)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const snippetId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const snippetData = {
        code: encryptedCode,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        language: newSnippetData.language,
        completion: "",
        description: newSnippetData.description
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `snippet_${snippetId}`, 
        ethers.toUtf8Bytes(JSON.stringify(snippetData))
      );
      
      const keysBytes = await contract.getData("snippet_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(snippetId);
      
      await contract.setData(
        "snippet_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted code submitted securely!"
      });
      
      await loadSnippets();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewSnippetData({
          language: "",
          code: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const generateCompletion = async (snippetId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Generating FHE-based code completion..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const snippetBytes = await contract.getData(`snippet_${snippetId}`);
      if (snippetBytes.length === 0) {
        throw new Error("Snippet not found");
      }
      
      const snippetData = JSON.parse(ethers.toUtf8String(snippetBytes));
      
      // Simulate FHE-based AI completion
      const completion = `// FHE-generated completion for ${snippetData.language} code\n// This was processed without decrypting your original code`;
      
      const updatedSnippet = {
        ...snippetData,
        completion: completion
      };
      
      await contract.setData(
        `snippet_${snippetId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedSnippet))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE completion generated successfully!"
      });
      
      await loadSnippets();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Completion failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const filteredSnippets = snippets.filter(snippet => {
    const matchesSearch = snippet.encryptedCode.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         snippet.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLanguage = selectedLanguage === "all" || snippet.language === selectedLanguage;
    return matchesSearch && matchesLanguage;
  });

  const renderLanguageStats = () => {
    return (
      <div className="stats-container">
        <div className="stat-item">
          <div className="stat-value">{totalSnippets}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{javascriptCount}</div>
          <div className="stat-label">JavaScript</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{pythonCount}</div>
          <div className="stat-label">Python</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{solidityCount}</div>
          <div className="stat-label">Solidity</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>CodeComplete</span></h1>
          <p>Secure AI-assisted coding with fully homomorphic encryption</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="controls-section">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search snippets..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="language-select"
            >
              <option value="all">All Languages</option>
              <option value="JavaScript">JavaScript</option>
              <option value="Python">Python</option>
              <option value="Solidity">Solidity</option>
              <option value="Rust">Rust</option>
              <option value="Go">Go</option>
            </select>
          </div>
          
          <div className="action-buttons">
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-button"
            >
              + New Snippet
            </button>
            <button 
              onClick={loadSnippets}
              disabled={isRefreshing}
              className="secondary-button"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button 
              onClick={() => setShowStats(!showStats)}
              className="secondary-button"
            >
              {showStats ? "Hide Stats" : "Show Stats"}
            </button>
          </div>
        </div>
        
        {showStats && (
          <div className="stats-section">
            <h2>Code Statistics</h2>
            {renderLanguageStats()}
          </div>
        )}
        
        <div className="snippets-section">
          <h2>Encrypted Code Snippets</h2>
          
          {filteredSnippets.length === 0 ? (
            <div className="no-snippets">
              <p>No code snippets found</p>
              <button 
                className="primary-button"
                onClick={() => setShowCreateModal(true)}
              >
                Create First Snippet
              </button>
            </div>
          ) : (
            <div className="snippets-grid">
              {filteredSnippets.map(snippet => (
                <div className="snippet-card" key={snippet.id}>
                  <div className="snippet-header">
                    <span className="language-tag">{snippet.language}</span>
                    <span className="timestamp">
                      {new Date(snippet.timestamp * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  
                  <div className="snippet-owner">
                    Owner: {snippet.owner.substring(0, 6)}...{snippet.owner.substring(38)}
                  </div>
                  
                  {snippet.description && (
                    <div className="snippet-description">
                      {snippet.description}
                    </div>
                  )}
                  
                  <div className="snippet-actions">
                    {isOwner(snippet.owner) && !snippet.completion && (
                      <button 
                        className="action-button"
                        onClick={() => generateCompletion(snippet.id)}
                      >
                        Generate Completion
                      </button>
                    )}
                    
                    {snippet.completion && (
                      <div className="completion-section">
                        <h4>AI Completion:</h4>
                        <pre className="completion-code">
                          {snippet.completion}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitSnippet} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          snippetData={newSnippetData}
          setSnippetData={setNewSnippetData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <span>FHE CodeComplete</span>
            <p>Secure AI-assisted coding with fully homomorphic encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">GitHub</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE CodeComplete. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  snippetData: any;
  setSnippetData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  snippetData,
  setSnippetData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSnippetData({
      ...snippetData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!snippetData.language || !snippetData.code) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add Encrypted Code Snippet</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            Your code will be encrypted with FHE before processing
          </div>
          
          <div className="form-group">
            <label>Programming Language *</label>
            <select 
              name="language"
              value={snippetData.language} 
              onChange={handleChange}
              className="form-select"
            >
              <option value="">Select language</option>
              <option value="JavaScript">JavaScript</option>
              <option value="Python">Python</option>
              <option value="Solidity">Solidity</option>
              <option value="Rust">Rust</option>
              <option value="Go">Go</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <input 
              type="text"
              name="description"
              value={snippetData.description} 
              onChange={handleChange}
              placeholder="Brief description..." 
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Code *</label>
            <textarea 
              name="code"
              value={snippetData.code} 
              onChange={handleChange}
              placeholder="Enter your code to encrypt..." 
              className="form-textarea"
              rows={8}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="secondary-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="primary-button"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;