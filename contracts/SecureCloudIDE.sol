// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecureCloudIDE is SepoliaConfig {
    // Encrypted code context structure
    struct EncryptedContext {
        euint32[] encryptedTokens; // Encrypted code tokens
        uint256 timestamp;
    }
    
    // Encrypted completion result
    struct EncryptedCompletion {
        euint32[] completionTokens; // Encrypted completion tokens
        uint256 contextId;
        uint256 timestamp;
    }
    
    // User session state
    struct UserSession {
        uint256 currentContextId;
        uint256 lastCompletionId;
        bool isActive;
    }
    
    // Contract state
    mapping(address => UserSession) public userSessions;
    mapping(uint256 => EncryptedContext) public codeContexts;
    mapping(uint256 => EncryptedCompletion) public completions;
    uint256 private contextCounter;
    uint256 private completionCounter;
    
    // Decryption tracking
    mapping(uint256 => uint256) private requestToContextId;
    mapping(uint256 => uint256) private requestToCompletionId;
    
    // Events
    event ContextSubmitted(address indexed user, uint256 contextId);
    event CompletionRequested(address indexed user, uint256 contextId);
    event CompletionGenerated(uint256 indexed completionId, uint256 contextId);
    event CompletionDecrypted(address indexed user, uint256 completionId);

    /// @notice Start a new coding session
    function startSession() external {
        require(!userSessions[msg.sender].isActive, "Session already active");
        userSessions[msg.sender] = UserSession({
            currentContextId: 0,
            lastCompletionId: 0,
            isActive: true
        });
    }

    /// @notice Submit encrypted code context
    function submitContext(euint32[] calldata encryptedTokens) external {
        require(userSessions[msg.sender].isActive, "No active session");
        
        uint256 newId = ++contextCounter;
        codeContexts[newId] = EncryptedContext({
            encryptedTokens: encryptedTokens,
            timestamp: block.timestamp
        });
        
        userSessions[msg.sender].currentContextId = newId;
        emit ContextSubmitted(msg.sender, newId);
    }

    /// @notice Request code completion for current context
    function requestCompletion() external {
        uint256 contextId = userSessions[msg.sender].currentContextId;
        require(contextId != 0, "No context submitted");
        
        EncryptedContext storage context = codeContexts[contextId];
        
        // Prepare encrypted context for processing
        bytes32[] memory ciphertexts = new bytes32[](context.encryptedTokens.length);
        for (uint i = 0; i < context.encryptedTokens.length; i++) {
            ciphertexts[i] = FHE.toBytes32(context.encryptedTokens[i]);
        }
        
        // Request AI processing
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleCompletion.selector);
        requestToContextId[reqId] = contextId;
        
        emit CompletionRequested(msg.sender, contextId);
    }

    /// @notice Handle generated completion
    function handleCompletion(
        uint256 requestId,
        bytes memory cleartext,
        bytes memory proof
    ) external {
        uint256 contextId = requestToContextId[requestId];
        require(contextId != 0, "Invalid request");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartext, proof);
        
        // Process AI-generated completion tokens
        euint32[] memory completionTokens = abi.decode(cleartext, (euint32[]));
        
        // Store encrypted completion
        uint256 newId = ++completionCounter;
        completions[newId] = EncryptedCompletion({
            completionTokens: completionTokens,
            contextId: contextId,
            timestamp: block.timestamp
        });
        
        emit CompletionGenerated(newId, contextId);
    }

    /// @notice Assign completion to user session
    function assignCompletion(uint256 completionId) external {
        require(userSessions[msg.sender].isActive, "No active session");
        userSessions[msg.sender].lastCompletionId = completionId;
    }

    /// @notice Request decryption of completion
    function requestCompletionDecryption() external {
        uint256 completionId = userSessions[msg.sender].lastCompletionId;
        require(completionId != 0, "No completion available");
        
        EncryptedCompletion storage comp = completions[completionId];
        
        // Prepare encrypted completion for decryption
        bytes32[] memory ciphertexts = new bytes32[](comp.completionTokens.length);
        for (uint i = 0; i < comp.completionTokens.length; i++) {
            ciphertexts[i] = FHE.toBytes32(comp.completionTokens[i]);
        }
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleDecryptedCompletion.selector);
        requestToCompletionId[reqId] = completionId;
    }

    /// @notice Handle decrypted completion
    function handleDecryptedCompletion(
        uint256 requestId,
        bytes memory cleartext,
        bytes memory proof
    ) external {
        uint256 completionId = requestToCompletionId[requestId];
        require(completionId != 0, "Invalid request");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartext, proof);
        
        // Process decrypted tokens
        string[] memory tokens = abi.decode(cleartext, (string[]));
        
        // In real implementation, send tokens to user interface
        emit CompletionDecrypted(msg.sender, completionId);
    }

    /// @notice End current session
    function endSession() external {
        require(userSessions[msg.sender].isActive, "No active session");
        userSessions[msg.sender].isActive = false;
    }
}