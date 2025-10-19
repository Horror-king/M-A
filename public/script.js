// --- CUT HERE ---
// --- CUT HERE ---
let isLogin = true;
let longPressTimer;
let isLongPress = false;
const badWords = ['fuck', 'nigga', 'shit', 'bitch', 'asshole'];
const spamTracker = {};
const SPAM_LIMIT = 5;
const SPAM_WINDOW = 10000;
const BAN_DURATION = 60000;
const bannedUsers = {};
const warnedUsers = {};

// SECRET CODE VERIFICATION VARIABLES
const SECRET_CODE = "456i";
let failedAttempts = 0;
const MAX_ATTEMPTS = 3;
let isLockedOut = false;
let lockoutTimeout = null;

// SQL Editor Variables
let sqlEditor = null;
let sqlResults = [];
let savedQueries = JSON.parse(localStorage.getItem('savedQueries')) || [];

// Notification variables
let lastMessageId = null;
let notificationPermissionGranted = false;

// Flag to prevent duplicate sends
let isSending = false;

// Scroll state variables
let isAtBottom = true;
let newMessagesCount = 0;
let scrollToBottomBtn;
let newMessagesCountEl = document.getElementById('newMessagesCount');

// Real-time active status variables
let socket;
let isTyping = false;
let typingTimer;

// ✅ ADDED: Flag to track if we're processing a command to prevent duplicates
let isProcessingCommand = false;

// ✅ ADDED: Track online users for profile popup
let onlineUsers = [];

// ✅ ADDED: Private Messaging Variables
let currentPrivateChatUser = null;
let privateMessageTypingTimer;

// ✅ ADDED: Track last sent messages to prevent duplicates
let lastSentMessages = {
    private: {},
    main: {}
};

// ✅ ADDED: User Panel Visibility State
let userPanelVisible = true;

// ✅ ADDED: Current user session
let currentUserSession = null;

const elements = {
    usernameInput: document.getElementById('auth-username'),
    messageInput: document.getElementById('user-input'),
    sendButton: document.getElementById('send-button'),
    chatContainer: document.getElementById('chat-container'),
    replyPreview: document.getElementById('reply-preview-container'),
    errorDisplay: document.getElementById('error-message'),
    successDisplay: document.getElementById('success-message'),
    privateInput: document.getElementById('private-user-input'),
    privateSendButton: document.getElementById('private-send-button')
};

let replyToText = null;

// ===== AUTHENTICATION FUNCTIONS =====
async function handleAuth() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const loader = document.getElementById('loader');
    
    elements.errorDisplay.style.display = 'none';
    elements.successDisplay.style.display = 'none';
    
    if (!username || !password) {
        showError('Please enter both username and password');
        return;
    }
    
    if (username.length < 3 || username.length > 20) {
        showError('Username must be between 3-20 characters');
        return;
    }
    
    if (password.length < 4 || password.length > 20) {
        showError('Password must be between 4-20 characters');
        return;
    }
    
    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        showError('Username can only contain letters, numbers, and underscores');
        return;
    }
    
    loader.style.display = 'flex';
    
    try {
        if (isLogin) {
            // Login - USING UPDATED ENDPOINT
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showSuccess('Login successful!');
                
                // Save user session with token for persistent login
                saveUserSession({
                    username: data.username,
                    user_id: data.user_id,
                    token: data.token
                });
                
                setTimeout(() => {
                    loader.style.display = 'none';
                    document.getElementById('auth-container').style.display = 'none';
                    document.querySelector('.menu').style.display = 'flex';
                    document.querySelector('.news-toggle').style.display = 'block';
                    
                    initializeButtons();
                    showContainer('chat');
                    loadProfile();
                    initializeChat();

                    initSocket();
                    setupTypingHandlers();
                    
                    document.addEventListener('visibilitychange', handleVisibilityChange);
                    window.addEventListener('beforeunload', handleBeforeUnload);
                    window.addEventListener('pagehide', handlePageHide);
                    
                    if (hasVerifiedCode()) {
                        enableSQLEditorAccess();
                    }
                }, 500);
            } else {
                throw new Error(data.error || 'Login failed');
            }
        } else {
            // Signup - USING UPDATED ENDPOINT
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showSuccess('Account created successfully! Please login.');
                setTimeout(() => {
                    loader.style.display = 'none';
                    toggleAuth();
                }, 1000);
            } else {
                throw new Error(data.error || 'Registration failed');
            }
        }
    } catch (error) {
        loader.style.display = 'none';
        showError(error.message);
    }
}

function toggleAuth() {
    isLogin = !isLogin;
    const authTitle = document.getElementById('auth-title');
    const authButton = document.querySelector('.auth-box button');
    const toggleText = document.getElementById('toggle-text');
    const toggleLink = document.getElementById('toggle-link');
    elements.errorDisplay.style.display = 'none';
    elements.successDisplay.style.display = 'none';
    
    if (isLogin) {
        authTitle.textContent = 'Login';
        authButton.textContent = 'Login';
        toggleText.textContent = "Don't have an account? ";
        toggleLink.textContent = 'Sign Up';
    } else {
        authTitle.textContent = 'Sign Up';
        authButton.textContent = 'Sign Up';
        toggleText.textContent = 'Already have an account? ';
        toggleLink.textContent = 'Login';
    }
    
    // Reset username validation
    const usernameInput = document.getElementById('auth-username');
    if (usernameInput) {
        usernameInput.classList.remove('username-valid', 'username-invalid');
    }
}

// ===== ENHANCED USER SESSION MANAGEMENT =====
function checkUserSession() {
    // Check localStorage first for persistent login
    const savedSession = localStorage.getItem('userSession');
    const savedToken = localStorage.getItem('auth_token');
    
    if (savedSession && savedToken) {
        try {
            currentUserSession = JSON.parse(savedSession);
            return true;
        } catch (e) {
            console.error('Error parsing saved session:', e);
            clearUserSession();
        }
    }
    
    // Fallback to sessionStorage
    const sessionData = sessionStorage.getItem('currentUserSession');
    if (sessionData) {
        currentUserSession = JSON.parse(sessionData);
        return true;
    }
    return false;
}

function saveUserSession(userData) {
    currentUserSession = userData;
    
    // Save to both sessionStorage (for current session) and localStorage (for persistence)
    sessionStorage.setItem('currentUserSession', JSON.stringify(userData));
    localStorage.setItem('userSession', JSON.stringify(userData));
    
    // Also store token for API calls
    if (userData.token) {
        localStorage.setItem('auth_token', userData.token);
    }
    
    console.log('✅ User session saved for persistent login');
}

function clearUserSession() {
    currentUserSession = null;
    sessionStorage.removeItem('currentUserSession');
    localStorage.removeItem('userSession');
    localStorage.removeItem('auth_token');
    console.log('✅ User session cleared');
}

// ===== AUTO-LOGIN FUNCTIONALITY =====
async function attemptAutoLogin() {
    const savedSession = localStorage.getItem('userSession');
    const savedToken = localStorage.getItem('auth_token');
    
    if (!savedSession || !savedToken) {
        return false;
    }
    
    try {
        const userData = JSON.parse(savedSession);
        const response = await fetch('/api/auth/auto-login', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${savedToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Auto-login successful for:', data.username);
            
            // Update session with fresh data
            saveUserSession({
                ...userData,
                username: data.username,
                user_id: data.user_id
            });
            
            // Hide auth container and show main interface
            document.getElementById('auth-container').style.display = 'none';
            document.querySelector('.menu').style.display = 'flex';
            document.querySelector('.news-toggle').style.display = 'block';
            
            initializeButtons();
            showContainer('chat');
            loadProfile();
            initializeChat();

            initSocket();
            setupTypingHandlers();
            
            document.addEventListener('visibilitychange', handleVisibilityChange);
            window.addEventListener('beforeunload', handleBeforeUnload);
            window.addEventListener('pagehide', handlePageHide);
            
            if (hasVerifiedCode()) {
                enableSQLEditorAccess();
            }
            
            showSuccess(`Welcome back, ${data.username}!`);
            return true;
        } else {
            // Auto-login failed, clear invalid session
            clearUserSession();
            return false;
        }
    } catch (error) {
        console.error('Auto-login error:', error);
        clearUserSession();
        return false;
    }
}

// ===== UTILITY FUNCTIONS =====
function showSuccess(message) {
    elements.successDisplay.textContent = message;
    elements.successDisplay.style.display = 'block';
    setTimeout(() => {
        elements.successDisplay.style.display = 'none';
    }, 3000);
}

function showError(message) {
    elements.errorDisplay.textContent = message;
    elements.errorDisplay.style.display = 'block';
    setTimeout(() => {
        elements.errorDisplay.style.display = 'none';
    }, 3000);
}

function autoResize(textarea) {
    if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight > 100 ? 100 : textarea.scrollHeight) + 'px';
    }
}

// ===== SECTION MANAGEMENT FUNCTIONS =====
function showContainer(containerId) {
    console.log('🔄 Showing container:', containerId);
    
    // Hide all containers
    document.querySelectorAll('.main-chat-interface').forEach(container => {
        container.style.display = 'none';
    });
    
    // Hide all info containers (INCLUDING PROFILE CONTAINER)
    document.querySelectorAll('.about-container, .features-container, .help-container, .secret-code-container, .sql-editor-container, .profile-container').forEach(container => {
        container.style.display = 'none';
    });
    
    // Hide all chat inputs
    document.querySelectorAll('.chat-input').forEach(input => {
        input.style.display = 'none';
    });
    
    // Show the selected container
    const container = document.getElementById(containerId);
    if (container) {
        container.style.display = 'block';
        
        // Show the appropriate chat input
        if (containerId === 'chat' || containerId === 'private-ai') {
            const chatInput = container.querySelector('.chat-input');
            if (chatInput) chatInput.style.display = 'flex';
        }
        
        // For private messages, only show users panel initially
        if (containerId === 'private-messages') {
            showUsersPanel();
            initializePrivateMessaging();
        }
        
        // Load profile data when showing profile container
        if (containerId === 'profile') {
            loadProfile();
        }
        
        // Initialize secret code if showing that container
        if (containerId === 'secret-code') {
            resetSecretCodeForm();
            initializeSecretCodeVerification();
        }
        
        // Initialize SQL editor if showing that container
        if (containerId === 'sql-editor-container') {
            // Check if user has verified the secret code
            if (!hasVerifiedCode()) {
                showError('Access denied. Please verify the secret code first.');
                showContainer('secret-code');
                return;
            }
            initializeSQLEditor();
        }
    }
    
    // Show overlay for non-chat containers
    const overlay = document.getElementById('overlay');
    if (overlay) {
        if (containerId === 'chat' || containerId === 'private-ai' || containerId === 'private-messages') {
            overlay.style.display = 'none';
        } else {
            overlay.style.display = 'block';
        }
    }
    
    // Handle button visibility based on container
    if (containerId === 'chat') {
        console.log('Showing main chat container');
        // Re-initialize scroll button for main chat
        setTimeout(() => {
            initializeButtons();
            // FIXED: Force scroll to bottom when switching to chat
            setTimeout(() => {
                forceScrollToBottom('chat-container');
                updateScrollState();
            }, 200);
        }, 100);
        
        // Show main chat scroll button, hide private AI button
        if (scrollToBottomBtn) {
            scrollToBottomBtn.style.display = 'flex';
            updateScrollState();
        }
        if (privateGoTopBtn) {
            privateGoTopBtn.style.display = 'none';
            privateGoTopBtn.classList.remove('visible');
        }
    } else if (containerId === 'private-ai') {
        // Show private AI button, hide main chat scroll button
        if (privateGoTopBtn) {
            privateGoTopBtn.style.display = 'flex';
            handlePrivateScroll();
        }
        if (scrollToBottomBtn) {
            scrollToBottomBtn.style.display = 'none';
            scrollToBottomBtn.classList.remove('visible');
        }
        // Attach scroll event for private container
        if (privateContainer) {
            privateContainer.addEventListener('scroll', handlePrivateScroll);
            setTimeout(handlePrivateScroll, 100);
            // FIXED: Scroll to bottom when switching to private AI
            setTimeout(() => forceScrollToBottom('private-ai-container'), 200);
        }
    } else if (containerId === 'private-messages') {
        // Hide both buttons for private messages
        if (scrollToBottomBtn) {
            scrollToBottomBtn.style.display = 'none';
            scrollToBottomBtn.classList.remove('visible');
        }
        if (privateGoTopBtn) {
            privateGoTopBtn.style.display = 'none';
            privateGoTopBtn.classList.remove('visible');
        }
    } else {
        // For other containers, hide both buttons
        if (scrollToBottomBtn) {
            scrollToBottomBtn.style.display = 'none';
            scrollToBottomBtn.classList.remove('visible');
        }
        if (privateGoTopBtn) {
            privateGoTopBtn.style.display = 'none';
            privateGoTopBtn.classList.remove('visible');
        }
    }

    // Close dropdown menu when switching containers
    const dropdown = document.getElementById('dropdown');
    if (dropdown) dropdown.style.display = 'none';
    
    const kebabDropdown = document.querySelector('.kebab-dropdown');
    if (kebabDropdown) kebabDropdown.classList.remove('active');
}

function hideContainer(containerId) {
    console.log('🔄 Hiding container:', containerId);
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'none';
    
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
    
    // Close all menus when hiding any container
    const dropdown = document.getElementById('dropdown');
    if (dropdown) dropdown.style.display = 'none';
    
    const kebabDropdown = document.querySelector('.kebab-dropdown');
    if (kebabDropdown) kebabDropdown.classList.remove('active');
    
    // Show chat container and input after closing any section
    showContainer('chat');
}

// ===== MESSAGE FUNCTIONS =====
async function sendMessage() {
    if (isSending || isProcessingCommand) return;
    isSending = true;
    
    const content = elements.messageInput.value.trim();
    const username = currentUserSession?.username;
    
    if (!content || !username) {
        isSending = false;
        return showError('Please enter both username and message');
    }

    // ADDED: Check for duplicate message in main chat
    const messageKey = `main-${username}-${content}`;
    if (lastSentMessages.main[messageKey] && 
        Date.now() - lastSentMessages.main[messageKey] < 3000) {
        console.log('Duplicate message prevented in main chat');
        isSending = false;
        return;
    }
    
    // ADDED: Track this message
    lastSentMessages.main[messageKey] = Date.now();

    // Bad word filtering
    const lowerContent = content.toLowerCase();
    if (badWords.some(word => lowerContent.includes(word))) {
        if (!warnedUsers[username]) {
            warnedUsers[username] = true;
            isSending = false;
            return showError('Warning: bad word detected! If you repeat, you will be banned.');
        } else {
            bannedUsers[username] = Date.now() + BAN_DURATION;
            showError('You used bad words again. Account deleted and banned.');
            isSending = false;
            setTimeout(() => {
                logout();
            }, 2000);
            return;
        }
    }

    // Spam protection
    const now = Date.now();
    if (bannedUsers[username] && bannedUsers[username] > now) {
        isSending = false;
        return showError(`You're banned. Wait ${Math.ceil((bannedUsers[username] - now) / 1000)}s.`);
    }
    
    if (!spamTracker[username]) {
        spamTracker[username] = [];
    }
    spamTracker[username].push(now);
    spamTracker[username] = spamTracker[username].filter(ts => now - ts <= SPAM_WINDOW);
    
    if (spamTracker[username].length > SPAM_LIMIT) {
        bannedUsers[username] = now + BAN_DURATION;
        isSending = false;
        return showError("You're banned for spamming.");
    }

    try {
        elements.sendButton.disabled = true;
        elements.sendButton.classList.remove('enabled');
        
        const payload = { 
            content, 
            username, 
            reply_to: replyToText || null 
        };
        
        // Send message to server via HTTP - USING UPDATED ENDPOINT
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to send message');

        // FIXED: Display message immediately for the sender with proper scrolling
        displayMessage(content, 'sent', replyToText, username, null, true);
        
        // Clear input immediately for better UX
        elements.messageInput.value = '';
        autoResize(elements.messageInput);
        clearReply();

        // FIXED: Only get AI response if it's NOT a command
        const PREFIX = '!';
        if (!content.startsWith(PREFIX)) {
            fetchChatResponse(content);
        }
        
    } catch (error) {
        showError(error.message);
        
        // Remove from tracking on error
        delete lastSentMessages.main[messageKey];
    } finally {
        setTimeout(() => {
            isSending = false;
            const hasText = elements.messageInput.value.trim().length > 0;
            elements.sendButton.disabled = !hasText;
            elements.sendButton.classList.toggle('enabled', hasText);
        }, 500);
    }
}

async function sendPrivateMessage() {
    const input = document.getElementById('private-user-input');
    if (!input) return;
    
    const content = input.value.trim();
    if (!content) return;

    // Display user message immediately
    displayPrivateMessage(content, 'sent');
    input.value = '';
    autoResize(input);

    // Disable send button after sending
    elements.privateSendButton.disabled = true;
    elements.privateSendButton.classList.remove('enabled');

    try {
        // Get AI response directly instead of using socket for private messages
        await fetchPrivateAIResponse(content);
    } catch (error) {
        console.error('Error sending private message:', error);
        showError('Could not process your private message. Please try again.');
    }

    // Re-enable send button after processing
    setTimeout(() => {
        const hasText = input.value.trim().length > 0;
        elements.privateSendButton.disabled = !hasText;
        elements.privateSendButton.classList.toggle('enabled', hasText);
    }, 1000);
}

// ===== MESSAGE DISPLAY FUNCTIONS =====
function displayMessage(text, sender, repliedTo = null, username = '', messageId = null, isNew = true) {
    if (!elements.chatContainer) return;
    
    // Check if message already exists to prevent duplicates
    const existingMessage = document.querySelector(`[data-id="${messageId}"]`);
    if (existingMessage) {
        console.log('⚠️ Message already exists, skipping:', messageId);
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    if (messageId) messageDiv.dataset.id = messageId;
    messageDiv.dataset.content = text;
    messageDiv.dataset.username = username;

    // Only create avatar for received messages
    if (sender === 'received') {
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'avatar';
        
        // Get user profile to display correct avatar
        const avatarUrl = `https://i.pravatar.cc/50?u=${encodeURIComponent(username)}`;
        
        avatarDiv.innerHTML = `<img src="${avatarUrl}" alt="avatar">`;
        
        // ADDED: Add click event to show user profile
        avatarDiv.onclick = (e) => {
            e.stopPropagation();
            showUserProfile(username);
        };
        
        messageDiv.appendChild(avatarDiv);

        const messageBody = document.createElement('div');
        messageBody.className = 'message-body';
        
        // Username with status indicator
        const usernameDiv = document.createElement('div');
        usernameDiv.className = 'username';
        
        // ADDED: Add click event to username to show user profile
        usernameDiv.onclick = (e) => {
            e.stopPropagation();
            showUserProfile(username);
        };
        
        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'user-status-indicator online';
        usernameDiv.appendChild(document.createTextNode(username));
        usernameDiv.appendChild(statusIndicator);
        messageBody.appendChild(usernameDiv);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        if (repliedTo) {
            const replyBubble = document.createElement('div');
            replyBubble.className = 'reply-preview';
            replyBubble.textContent = repliedTo;
            contentDiv.appendChild(replyBubble);
        }

        const imagePattern = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp))/gi;
        const audioPattern = /(https?:\/\/[^\s]+\.(?:mp3|ogg|wav|m4a|mp4))/gi;
        const imageMatches = [...text.matchAll(imagePattern)];
        const audioMatches = [...text.matchAll(audioPattern)];
        let modifiedText = text;
        [...imageMatches, ...audioMatches].forEach(match => {
            modifiedText = modifiedText.replace(match[0], '');
        });
        modifiedText = modifiedText.trim();
        if (modifiedText) {
            const textDiv = document.createElement('div');
            textDiv.textContent = modifiedText;
            contentDiv.appendChild(textDiv);
        }

        // FIXED: Use immediate image loading
        imageMatches.forEach(match => {
            displayImageImmediately(match[0], contentDiv);
        });

        audioMatches.forEach(match => {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = match[0];
            contentDiv.appendChild(audio);
        });
        messageBody.appendChild(contentDiv);
        messageDiv.appendChild(messageBody);
    } else {
        // For sent messages - simpler structure without avatar/username
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        if (repliedTo) {
            const replyBubble = document.createElement('div');
            replyBubble.className = 'reply-preview';
            replyBubble.textContent = repliedTo;
            contentDiv.appendChild(replyBubble);
        }
        const textDiv = document.createElement('div');
        textDiv.textContent = text;
        contentDiv.appendChild(textDiv);
        messageDiv.appendChild(contentDiv);
    }
    
    // FIXED: Always append new messages to the bottom
    elements.chatContainer.appendChild(messageDiv);
    
    messageDiv.addEventListener('touchstart', handleTouchStart);
    messageDiv.addEventListener('touchend', handleTouchEnd);
    messageDiv.addEventListener('touchmove', handleTouchMove);
    messageDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMessageContextMenu(e, messageDiv);
    });

    // Force image rendering after adding message
    setTimeout(forceImageRendering, 50);

    // FIXED: ALWAYS SCROLL TO BOTTOM FOR NEW MESSAGES
    if (isNew) {
        setTimeout(() => {
            forceScrollToBottom('chat-container');
            // Additional scroll to ensure it works
            setTimeout(() => forceScrollToBottom('chat-container'), 30);
        }, 10);
    }

    // Update scroll state after adding message
    setTimeout(updateScrollState, 0);
}

function displayPrivateMessage(text, sender, repliedTo = null, username = 'Private AI', messageId = null) {
    const container = document.getElementById('private-ai-container');
    if (!container) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    messageDiv.dataset.content = text;
    messageDiv.dataset.username = username;

    // Only create avatar for received messages
    if (sender === 'received') {
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'avatar';
        avatarDiv.innerHTML = `<img src="https://i.pravatar.cc/50?u=${encodeURIComponent(username)}" alt="avatar">`;
        messageDiv.appendChild(avatarDiv);
    }

    const messageBody = document.createElement('div');
    messageBody.className = 'message-body';
    
    if (username && sender === 'received') {
        const usernameDiv = document.createElement('div');
        usernameDiv.className = 'username';
        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'user-status-indicator online';
        usernameDiv.appendChild(document.createTextNode(username));
        usernameDiv.appendChild(statusIndicator);
        messageBody.appendChild(usernameDiv);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    
    // Parse for image URLs and render them as images
    const imagePattern = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp))/gi;
    const audioPattern = /(https?:\/\/[^\s]+\.(?:mp3|ogg|wav|m4a|mp4))/gi;
    const imageMatches = [...text.matchAll(imagePattern)];
    const audioMatches = [...text.matchAll(audioPattern)];
    let modifiedText = text;
    
    [...imageMatches, ...audioMatches].forEach(match => {
        modifiedText = modifiedText.replace(match[0], '');
    });
    modifiedText = modifiedText.trim();
    
    if (modifiedText) {
        const textDiv = document.createElement('div');
        textDiv.textContent = modifiedText;
        contentDiv.appendChild(textDiv);
    }

    // Add images to the message - FIXED: Use immediate loading
    imageMatches.forEach(match => {
        displayImageImmediately(match[0], contentDiv);
    });

    // Add audio files to the message
    audioMatches.forEach(match => {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = match[0];
        contentDiv.appendChild(audio);
    });

    messageBody.appendChild(contentDiv);
    messageDiv.appendChild(messageBody);
    
    // FIXED: Always append to the bottom of private chat container
    container.appendChild(messageDiv);

    // ADDED: Add event listeners for long press and context menu to private AI messages
    messageDiv.addEventListener('touchstart', handlePrivateMessageTouchStart);
    messageDiv.addEventListener('touchend', handlePrivateMessageTouchEnd);
    messageDiv.addEventListener('touchmove', handlePrivateMessageTouchMove);
    messageDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showPrivateMessageContextMenu(e, messageDiv);
    });

    // FIXED: IMMEDIATELY scroll to bottom for private chat
    setTimeout(() => {
        forceScrollToBottom('private-ai-container');
        setTimeout(() => forceScrollToBottom('private-ai-container'), 50);
    }, 10);
}

// ===== SCROLL FUNCTIONS =====
function forceScrollToBottom(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Multiple methods to ensure scrolling works
    const scrollToBottom = () => {
        // Method 1: Direct scroll
        container.scrollTop = container.scrollHeight;
        
        // Method 2: Smooth scroll
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
        
        // Method 3: Alternative approach
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 10);
    };
    
    // Initial scroll
    scrollToBottom();
    
    // Additional attempts to handle dynamic content loading
    setTimeout(scrollToBottom, 50);
    setTimeout(scrollToBottom, 100);
    setTimeout(scrollToBottom, 200);
}

function scrollToBottomMain() {
    forceScrollToBottom('chat-container');
    isAtBottom = true;
    newMessagesCount = 0;
    if (newMessagesCountEl) newMessagesCountEl.textContent = '0';
    if (scrollToBottomBtn) {
        scrollToBottomBtn.classList.remove('visible');
        setTimeout(() => {
            scrollToBottomBtn.style.display = 'none';
        }, 300);
    }
}

function updateScrollState() {
    const chatContainer = document.getElementById('chat-container');
    if (!chatContainer || !scrollToBottomBtn) return;
    
    const scrollTop = chatContainer.scrollTop;
    const scrollHeight = chatContainer.scrollHeight;
    const clientHeight = chatContainer.clientHeight;
    
    // Calculate if we're at the bottom (within 50px threshold)
    const isAtBottomNow = Math.abs(scrollHeight - scrollTop - clientHeight) <= 50;
    
    console.log('Scroll state:', {
        scrollTop,
        scrollHeight, 
        clientHeight,
        isAtBottomNow,
        wasAtBottom: isAtBottom
    });
    
    if (!isAtBottomNow) {
        // User has scrolled up - show the button
        if (!scrollToBottomBtn.classList.contains('visible')) {
            scrollToBottomBtn.style.display = 'flex';
            setTimeout(() => {
                scrollToBottomBtn.classList.add('visible');
            }, 10);
        }
        
        // Update new messages count if we're receiving messages while scrolled up
        if (isAtBottom && !isAtBottomNow) {
            newMessagesCount++;
            if (newMessagesCountEl) {
                newMessagesCountEl.textContent = newMessagesCount;
            }
        }
    } else {
        // User is at bottom - hide the button
        if (scrollToBottomBtn.classList.contains('visible')) {
            scrollToBottomBtn.classList.remove('visible');
            setTimeout(() => {
                scrollToBottomBtn.style.display = 'none';
            }, 300);
        }
        newMessagesCount = 0;
        if (newMessagesCountEl) newMessagesCountEl.textContent = '0';
    }
    
    isAtBottom = isAtBottomNow;
}

// ===== TOUCH AND CONTEXT MENU FUNCTIONS =====
function handleTouchStart(e) {
    isLongPress = false;
    e.currentTarget.classList.add('no-select');
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        showMessageContextMenu(e, e.currentTarget);
    }, 500);
}

function handleTouchMove(e) {
    clearTimeout(longPressTimer);
    e.currentTarget.classList.remove('no-select');
}

function handleTouchEnd(e) {
    clearTimeout(longPressTimer);
    e.currentTarget.classList.remove('no-select');
}

function handlePrivateMessageTouchStart(e) {
    isLongPress = false;
    e.currentTarget.classList.add('no-select');
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        showPrivateMessageContextMenu(e, e.currentTarget);
    }, 500);
}

function handlePrivateMessageTouchMove(e) {
    clearTimeout(longPressTimer);
    e.currentTarget.classList.remove('no-select');
}

function handlePrivateMessageTouchEnd(e) {
    clearTimeout(longPressTimer);
    e.currentTarget.classList.remove('no-select');
}

function showMessageContextMenu(e, message) {
    const messageText = message.dataset.content || '';
    const messageId = message.dataset.id;
    document.querySelectorAll('.message-context-menu').forEach(menu => menu.remove());

    const contextMenu = document.createElement('div');
    contextMenu.className = 'message-context-menu active';
    contextMenu.style.left = `${(e.touches?.[0]?.pageX || e.clientX)}px`;
    contextMenu.style.top = `${(e.touches?.[0]?.pageY || e.clientY)}px`;

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.onclick = () => {
        copyToClipboard(messageText, copyButton);
        contextMenu.remove();
    };

    const replyButton = document.createElement('button');
    replyButton.textContent = 'Reply';
    replyButton.onclick = () => {
        replyToText = messageText;
        elements.messageInput.focus();
        showReplyPreview();
        contextMenu.remove();
    };

    contextMenu.appendChild(copyButton);
    contextMenu.appendChild(replyButton);

    if (messageId && message.classList.contains('sent')) {
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.onclick = async () => {
            try {
                const token = localStorage.getItem('auth_token');
                const response = await fetch(`/api/messages/${messageId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': token ? `Bearer ${token}` : ''
                    }
                });
                if (!response.ok) throw new Error('Delete failed');
                message.remove();
            } catch (err) {
                showError(err.message);
            }
            contextMenu.remove();
        };
        contextMenu.appendChild(deleteButton);
    }

    document.body.appendChild(contextMenu);
    document.addEventListener('click', () => contextMenu.remove(), {
        once: true
    });
}

function showPrivateMessageContextMenu(e, message) {
    const messageText = message.dataset.content || '';
    document.querySelectorAll('.message-context-menu').forEach(menu => menu.remove());

    const contextMenu = document.createElement('div');
    contextMenu.className = 'message-context-menu active';
    contextMenu.style.left = `${(e.touches?.[0]?.pageX || e.clientX)}px`;
    contextMenu.style.top = `${(e.touches?.[0]?.pageY || e.clientY)}px`;

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.onclick = () => {
        copyToClipboard(messageText, copyButton);
        contextMenu.remove();
    };

    const replyButton = document.createElement('button');
    replyButton.textContent = 'Reply';
    replyButton.onclick = () => {
        // For private AI, we can implement reply functionality if needed
        // For now, just copy and close the menu
        copyToClipboard(messageText, copyButton);
        contextMenu.remove();
    };

    contextMenu.appendChild(copyButton);
    contextMenu.appendChild(replyButton);

    document.body.appendChild(contextMenu);
    document.addEventListener('click', () => contextMenu.remove(), {
        once: true
    });
}

function copyToClipboard(text, button) {  
    const textarea = document.createElement('textarea');  
    textarea.value = text;  
    document.body.appendChild(textarea);  
    textarea.select();  
    document.execCommand('copy');  
    document.body.removeChild(textarea);  

    button.innerHTML = '<span style="font-size: 15px;">Copied!</span>';  
    setTimeout(() => {  
        button.innerHTML = 'Copy';  
    }, 2000);  
}

function showReplyPreview() {
    if (!elements.replyPreview) return;
    elements.replyPreview.innerHTML = `
        <div class="reply-preview">
            Replying to: ${replyToText.substring(0, 80)}
            <button onclick="clearReply()" style="float:right; font-size:12px;">✕</button>
        </div>
    `;
}

function clearReply() {
    replyToText = null;
    if (elements.replyPreview) {
        elements.replyPreview.style.display = 'none';
        elements.replyPreview.textContent = '';
    }
}

// ===== MENU AND NAVIGATION FUNCTIONS =====
function toggleDropdown() {
    const dropdown = document.getElementById('dropdown');
    if (!dropdown) return;
    
    const isVisible = dropdown.style.display === 'block';
    
    // Close all other menus first
    const kebabDropdown = document.querySelector('.kebab-dropdown');
    if (kebabDropdown) kebabDropdown.classList.remove('active');
    
    // Toggle dropdown
    dropdown.style.display = isVisible ? 'none' : 'block';
    
    // Close if clicking the same button while open
    if (isVisible) {
        dropdown.style.display = 'none';
    }
}

function toggleKebabMenu(event) {
    event.stopPropagation();
    const dropdown = document.querySelector('.kebab-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('active');
    }
}

function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const dropdown = document.querySelector('.kebab-dropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }
}

function clearChat() {
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
        chatContainer.innerHTML = '';
    }
    const dropdown = document.querySelector('.kebab-dropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }
}

function exportChat() {
    const chatContainer = document.getElementById('chat-container');
    if (!chatContainer) return;
    
    const messages = chatContainer.innerText;
    const blob = new Blob([messages], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chat-export.txt';
    a.click();
    window.URL.revokeObjectURL(url);
    const dropdown = document.querySelector('.kebab-dropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }
}

function exportChatPDF() {
    const chatContainer = document.getElementById('chat-container');
    if (!chatContainer) return;
    
    const dropdown = document.querySelector('.kebab-dropdown');
    if (!dropdown) return;

    const clone = chatContainer.cloneNode(true);

    // Show downloading alert
    const downloadingAlert = document.createElement('div');
    downloadingAlert.id = 'downloading-alert';
    downloadingAlert.textContent = 'Preparing download, please wait...';
    downloadingAlert.style.position = 'fixed';
    downloadingAlert.style.top = '20px';
    downloadingAlert.style.left = '50%';
    downloadingAlert.style.transform = 'translateX(-50%)';
    downloadingAlert.style.padding = '10px 20px';
    downloadingAlert.style.backgroundColor = '#333';
    downloadingAlert.style.color = '#fff';
    downloadingAlert.style.fontSize = '16px';
    downloadingAlert.style.borderRadius = '8px';
    downloadingAlert.style.zIndex = '9999';
    document.body.appendChild(downloadingAlert);

    // Find all images and replace src with base64
    const images = clone.querySelectorAll('img');
    const promises = [];

    images.forEach(img => {
        const promise = new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const originalImage = new Image();
            originalImage.crossOrigin = 'anonymous';
            originalImage.src = img.src;

            originalImage.onload = () => {
                try {
                    // Store original display style to restore later
                    const originalDisplay = img.style.display;
                    const originalWidth = img.style.width;
                    const originalHeight = img.style.height;

                    // Temporarily make image visible and full size for capture
                    img.style.display = 'block';
                    img.style.width = 'auto';
                    img.style.height = 'auto';
                    img.style.maxWidth = 'none';
                    img.style.maxHeight = 'none';

                    canvas.width = originalImage.naturalWidth;
                    canvas.height = originalImage.naturalHeight;
                    context.drawImage(originalImage, 0, 0);

                    const dataURL = canvas.toDataURL('image/png');
                    img.src = dataURL;

                    // Restore original styles
                    img.style.display = originalDisplay;
                    img.style.width = originalWidth;
                    img.style.height = originalHeight;

                    resolve();
                } catch (error) {
                    console.error('Error converting image:', error);
                    resolve();
                }
            };

            originalImage.onerror = () => {
                console.error('Error loading image:', img.src);
                resolve();
            };
        });
        promises.push(promise);
    });

    Promise.all(promises).then(() => {
        const opt = {
            margin: 10,
            filename: 'chat-export.pdf',
            image: { type: 'jpeg', quality: 1 },
            html2canvas: { 
                scale: 2,
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                windowWidth: document.documentElement.scrollWidth,
                windowHeight: document.documentElement.scrollHeight
            },
            jsPDF: { 
                unit: 'mm',
                format: 'a4',
                orientation: 'portrait',
                hotfixes: ['px_scaling'] 
            },
            pagebreak: { 
                mode: ['avoid-all', 'css', 'legacy'],
                before: '.page-break' 
            }
        };

        // Temporarily modify image styles for PDF generation
        const allImages = clone.querySelectorAll('img');
        allImages.forEach(img => {
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
        });

        html2pdf().set(opt).from(clone).save().then(() => {
            downloadingAlert.remove();
        }).catch((error) => {
            console.error('Error generating PDF:', error);
            downloadingAlert.remove();
        });

        dropdown.classList.remove('active');
    });
}

function showSettings() {
    alert('Settings panel coming soon!');
    const dropdown = document.querySelector('.kebab-dropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }
}

// ===== ENHANCED LOGOUT FUNCTION =====
function logout() {
    const username = currentUserSession?.username;
    
    // Notify server that user is going offline
    if (username && socket) {
        socket.emit('user-offline', username);
        // Disconnect socket
        socket.disconnect();
    }
    
    // Clear user session from both storage locations
    clearUserSession();
    
    // Remove page event listeners
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('pagehide', handlePageHide);
    
    // Hide all containers and menus
    document.querySelectorAll('.main-chat-interface').forEach(container => {
        container.style.display = 'none';
    });
    
    const menu = document.querySelector('.menu');
    if (menu) menu.style.display = 'none';
    
    const dropdown = document.getElementById('dropdown');
    if (dropdown) dropdown.style.display = 'none';
    
    const kebabDropdown = document.querySelector('.kebab-dropdown');
    if (kebabDropdown) kebabDropdown.classList.remove('active');
    
    // Hide all chat inputs
    document.querySelectorAll('.chat-input').forEach(input => {
        input.style.display = 'none';
    });
    
    // Show auth container
    document.getElementById('auth-container').style.display = 'flex';
    
    // Hide news toggle
    const newsToggle = document.querySelector('.news-toggle');
    if (newsToggle) newsToggle.style.display = 'none';
    
    const newsContainer = document.querySelector('.news-container');
    if (newsContainer) newsContainer.style.display = 'none';
    
    // Hide both buttons on logout
    if (scrollToBottomBtn) {
        scrollToBottomBtn.style.display = 'none';
        scrollToBottomBtn.classList.remove('visible');
    }
    if (privateGoTopBtn) {
        privateGoTopBtn.style.display = 'none';
        privateGoTopBtn.classList.remove('visible');
    }
    
    // Reset auth form
    isLogin = true;
    const authTitle = document.getElementById('auth-title');
    if (authTitle) authTitle.textContent = 'Login';
    
    const authButton = document.querySelector('.auth-box button');
    if (authButton) authButton.textContent = 'Login';
    
    const toggleText = document.getElementById('toggle-text');
    if (toggleText) toggleText.textContent = "Don't have an account? ";
    
    const toggleLink = document.getElementById('toggle-link');
    if (toggleLink) toggleLink.textContent = 'Sign Up';
    
    // Clear profile section
    const profileSection = document.querySelector('.profile-panel');
    const divider = document.querySelector('.menu-divider');
    if (profileSection) profileSection.remove();
    if (divider) divider.remove();
    
    // Clear any validation states
    const usernameInput = document.getElementById('auth-username');
    if (usernameInput) {
        usernameInput.classList.remove('username-valid', 'username-invalid');
        usernameInput.value = '';
    }
    document.getElementById('auth-password').value = '';
    
    console.log('✅ User logged out successfully');
}

// --- CUT HERE ---
function showNotification(username, message) {
    if (!notificationPermissionGranted || !('Notification' in window)) return;
    const notification = new Notification(`${username} says:`, {
        body: message.length > 50 ? message.substring(0, 50) + '...' : message,
        icon: 'https://i.pravatar.cc/50?u=' + encodeURIComponent(username)
    });
    notification.onclick = () => {
        window.focus();
    };
}

// ✅ FIXED: COMPLETELY REWRITTEN - No more duplicate responses
async function fetchChatResponse(userInput) {
    if (isProcessingCommand) {
        console.log('🛑 Command already being processed, skipping...');
        return;
    }

    isProcessingCommand = true;
    
    try {
        const PREFIX = '!'; // Make sure this matches your server prefix
        
        // Don't process commands that start with prefix - let the server handle them
        if (userInput.startsWith(PREFIX)) {
            console.log('🤖 Command detected, letting server handle response...');
            return;
        }
        
        // Only process non-command messages for AI response
        const response = await fetch('/api/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: userInput,
                source: 'main-chat'
            }),
        });
        
        // ✅ FIXED: Don't display the response here - let Socket.io handle it
        // The server will save the response and broadcast it via Socket.io
        // We'll display it when we receive the 'new-message' event
        console.log('🤖 Command sent to server, waiting for Socket.io response...');
        
    } catch (error) {
        console.error("Error fetching AI response:", error);
    } finally {
        // Reset the flag after a short delay
        setTimeout(() => {
            isProcessingCommand = false;
        }, 1000);
    }
}

async function fetchPrivateAIResponse(userInput) {
    try {
        const response = await fetch('/api/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: userInput,
                source: 'private-ai'
            }),
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.reply) {
            // Display in private AI container
            if (Array.isArray(data.reply)) {
                data.reply.forEach(reply => displayPrivateMessage(reply, 'received'));
            } else {
                displayPrivateMessage(data.reply, 'received');
            }
        } else {
            throw new Error('No reply from AI');
        }
    } catch (error) {
        console.error("Error fetching Private AI response:", error);
        displayPrivateMessage("Sorry, I encountered an error processing your message. Please try again.", 'received');
    }
}

// ===== IMAGE HANDLING FUNCTIONS =====
function displayImageImmediately(imgUrl, container) {
    return new Promise((resolve) => {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = "Image";
        img.loading = "eager"; // Force immediate loading
        img.style.opacity = "1";
        img.style.transition = "none";
        img.style.width = "100%";
        img.style.borderRadius = "10px";
        img.style.objectFit = "cover";
        
        // Force immediate display
        img.onload = function() {
            container.appendChild(img);
            resolve(img);
        };
        
        // Fallback in case onload doesn't fire
        setTimeout(() => {
            if (!img.parentNode) {
                container.appendChild(img);
            }
            resolve(img);
        }, 100);
    });
}

function forceImageRendering() {
    document.querySelectorAll('.message img').forEach(img => {
        // Force reflow and repaint
        img.style.display = 'none';
        img.offsetHeight; // Trigger reflow
        img.style.display = 'block';
        
        // Ensure full opacity
        img.style.opacity = '1';
        img.style.visibility = 'visible';
    });
}

// ===== ZOOM FUNCTIONS =====
function openZoom(src) {
    document.body.style.overflow = 'hidden';
    const overlay = document.getElementById('zoom-overlay');
    const zoomImage = document.getElementById('zoom-image');
    const downloadBtn = document.getElementById('download-btn');

    if (!overlay || !zoomImage || !downloadBtn) return;
    
    zoomImage.src = src;

    // Force download filename
    downloadBtn.href = src;
    downloadBtn.setAttribute('download', 'image.jpg');

    overlay.style.display = 'flex';
}

function closeZoom() {
    document.body.style.overflow = '';
    const overlay = document.getElementById('zoom-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ===== INITIALIZATION FUNCTIONS =====
function initializeButtons() {
    console.log('Initializing buttons...');
    
    // Initialize main chat scroll button
    scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
    if (scrollToBottomBtn) {
        console.log('Found main chat scroll button');
        scrollToBottomBtn.style.position = 'fixed';
        scrollToBottomBtn.style.bottom = '80px';
        scrollToBottomBtn.style.right = '20px';
        scrollToBottomBtn.style.zIndex = '1000';
        scrollToBottomBtn.style.display = 'none';
        scrollToBottomBtn.addEventListener('click', scrollToBottomMain);
        
        // Add proper scroll event listener to main chat
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.addEventListener('scroll', updateScrollState);
            console.log('Added scroll listener to main chat');
        }
    } else {
        console.log('Main chat scroll button NOT found');
    }

    // Initialize private AI go-top button
    privateGoTopBtn = document.getElementById('private-go-top');
    privateContainer = document.getElementById('private-ai-container');
    if (privateGoTopBtn) {
        console.log('Found private AI go-top button');
        privateGoTopBtn.style.position = 'fixed';
        privateGoTopBtn.style.bottom = '80px';
        privateGoTopBtn.style.right = '20px';
        privateGoTopBtn.style.zIndex = '1000';
        privateGoTopBtn.style.display = 'none';
        privateGoTopBtn.addEventListener('click', scrollPrivateToTop);
    }

    // Force initial state update
    setTimeout(updateScrollState, 100);
}

function initializeChat() {
    if (elements.messageInput) {
        elements.messageInput.addEventListener('input', () => {
            autoResize(elements.messageInput);
            const hasText = elements.messageInput.value.trim().length > 0;
            elements.sendButton.disabled = !hasText || isSending;
            elements.sendButton.classList.toggle('enabled', hasText && !isSending);
        });
        elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isSending) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
    loadMessages();
}

// ===== PRIVATE MESSAGING FUNCTIONS =====
function initializePrivateMessaging() {
    loadPrivateUsers();
    setupPrivateMessageInputHandlers();
    
    // ADDED: Clear old tracking data
    clearOldMessageTracking();
    
    // Listen for real-time private messages
    if (socket) {
        socket.on('new-private-message', (message) => {
            handleNewPrivateMessage(message);
        });
        
        socket.on('private-typing-indicator', (data) => {
            showPrivateTypingIndicator(data);
        });
    }
    
    // Initially show only users panel
    showUsersPanel();
    
    // Load unread counts
    loadUnreadCounts();
}

// ===== ADDED: USER PANEL VISIBILITY FUNCTIONS =====
function toggleUserPanel() {
    userPanelVisible = !userPanelVisible;
    updateUserPanelVisibility();
    saveUserPanelPreference();
    
    // Close the kebab menu after selection
    const kebabDropdown = document.querySelector('.kebab-dropdown');
    if (kebabDropdown) kebabDropdown.classList.remove('active');
}

function updateUserPanelVisibility() {
    const onlineUsersPanels = document.querySelectorAll('.online-users-panel');
    
    onlineUsersPanels.forEach(panel => {
        if (userPanelVisible) {
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    });
    
    // Update the toggle button text
    updateUserPanelToggleButton();
}

function saveUserPanelPreference() {
    localStorage.setItem('userPanelVisible', userPanelVisible.toString());
}

function loadUserPanelPreference() {
    const savedPreference = localStorage.getItem('userPanelVisible');
    if (savedPreference !== null) {
        userPanelVisible = savedPreference === 'true';
    } else {
        userPanelVisible = true; // Default to visible
    }
    updateUserPanelVisibility();
}

function updateUserPanelToggleButton() {
    const toggleButtons = document.querySelectorAll('.kebab-dropdown a[onclick="toggleUserPanel()"]');
    toggleButtons.forEach(button => {
        if (userPanelVisible) {
            button.innerHTML = '<i class="fas fa-eye-slash"></i> Hide User Panel';
        } else {
            button.innerHTML = '<i class="fas fa-eye"></i> Show User Panel';
        }
    });
}

// ===== ENHANCED PRIVATE MESSAGING FUNCTIONS =====

// Load users for private messaging from API
async function loadPrivateUsers() {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;
    
    const currentUser = currentUserSession?.username;
    if (!currentUser) {
        console.error('No current user found');
        usersList.innerHTML = '<div class="no-users">Please log in to view conversations</div>';
        return;
    }

    try {
        // Show loading
        usersList.innerHTML = '<div class="no-users">Loading conversations...</div>';
        
        // Get conversations from server - FIXED: Add username parameter
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/api/private/conversations?username=${encodeURIComponent(currentUser)}`, {
            headers: {
                'Authorization': token ? `Bearer ${token}` : '',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `Failed to load conversations: ${response.status}`);
        }
        
        const conversations = await response.json();
        
        // Clear existing list
        usersList.innerHTML = '';
        
        if (!conversations || conversations.length === 0) {
            usersList.innerHTML = '<div class="no-users">No conversations yet. Start a new conversation!</div>';
            return;
        }
        
        // Add conversations to the list
        conversations.forEach(conversation => {
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            if (conversation.unread) userItem.classList.add('unread');
            userItem.dataset.username = conversation.username;
            userItem.onclick = () => openPrivateChat(conversation.username);
            
            // For demo online status - in real app, use actual online status
            const isOnline = onlineUsers.includes(conversation.username);
            
            userItem.innerHTML = `
                <div class="user-avatar">
                    <img src="${conversation.avatar || `https://i.pravatar.cc/50?u=${conversation.username}`}" alt="${conversation.username}">
                    <div class="user-status ${isOnline ? 'online' : 'offline'}"></div>
                    ${conversation.unread ? '<div class="unread-badge"></div>' : ''}
                </div>
                <div class="user-info">
                    <div class="user-name">${conversation.displayName || conversation.username}</div>
                    <div class="user-last-message">${conversation.isSender ? 'You: ' : ''}${conversation.lastMessage || 'No messages'}</div>
                    <div class="user-time">${formatMessageTime(conversation.lastMessageTime)}</div>
                </div>
            `;
            
            usersList.appendChild(userItem);
        });
        
        // Add search functionality
        setupUsersSearch();
        
    } catch (error) {
        console.error('Error loading conversations:', error);
        usersList.innerHTML = `<div class="no-users">Error loading conversations: ${error.message}</div>`;
    }
}

// MODIFIED: Open private chat with a user - HIDE SEARCH CONTAINER
async function openPrivateChat(username) {
    currentPrivateChatUser = username;
    
    // Update UI to show active user
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.username === username) {
            item.classList.add('active');
        }
    });
    
    // HIDE SEARCH CONTAINER
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
        searchContainer.style.display = 'none';
    }
    
    // Adjust header to be more compact
    const privateMessagesHeader = document.querySelector('.private-messages-header');
    if (privateMessagesHeader) {
        privateMessagesHeader.style.padding = '8px 15px';
    }
    
    // Update chat header
    document.getElementById('partner-avatar').innerHTML = 
        `<img src="https://i.pravatar.cc/50?u=${username}" alt="${username}">`;
    
    document.getElementById('partner-name').textContent = username;
    
    // Set online status
    const isOnline = onlineUsers.includes(username);
    document.getElementById('partner-status').textContent = isOnline ? 'Online' : 'Offline';
    document.getElementById('partner-status').style.color = isOnline ? '#4CAF50' : '#65676b';
    
    // Show chat container and hide users panel
    showChatContainer();
    
    // Show chat input
    document.getElementById('private-chat-input').style.display = 'flex';
    
    // Join Socket.io room for real-time updates
    if (socket) {
        const currentUser = currentUserSession?.username;
        socket.emit('join-private-chat', { username: currentUser, otherUser: username });
    }
    
    // Load messages from API
    await loadPrivateMessages(username);
    
    // Mark messages as read
    await markMessagesAsRead(username);
}

// Load private messages from API
// Load private messages from API - UPDATED with better error handling
async function loadPrivateMessages(username) {
    const messagesContainer = document.getElementById('private-chat-messages');
    if (!messagesContainer) return;
    
    const currentUser = currentUserSession?.username;
    if (!currentUser) {
        console.error('No current user found');
        return;
    }
    
    try {
        messagesContainer.innerHTML = '<div class="no-messages">Loading messages...</div>';
        
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/api/private/messages/${currentUser}?otherUser=${encodeURIComponent(username)}`, {
            headers: {
                'Authorization': token ? `Bearer ${token}` : '',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `Failed to load messages: ${response.status}`);
        }
        
        const messages = await response.json();
        
        // Clear container
        messagesContainer.innerHTML = '';
        
        if (!messages || messages.length === 0) {
            messagesContainer.innerHTML = `
                <div class="no-messages">
                    <p>No messages yet. Start a conversation with ${username}!</p>
                </div>
            `;
            return;
        }
        
        // Display messages
        messages.forEach(message => {
            displayPrivateUserMessage(
                message.content, 
                message.sender_username === currentUser ? 'sent' : 'received',
                message.created_at,
                message.sender_username
            );
        });
        
        // Scroll to bottom
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
        
    } catch (error) {
        console.error('Error loading private messages:', error);
        messagesContainer.innerHTML = `<div class="no-messages">Error loading messages: ${error.message}</div>`;
    }
}

// Display private user message
function displayPrivateUserMessage(text, sender, timestamp, username) {
    const messagesContainer = document.getElementById('private-chat-messages');
    if (!messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `private-message ${sender}`;
    
    const time = formatMessageTime(timestamp);
    
    messageDiv.innerHTML = `
        <div class="message-content">${text}</div>
        <div class="message-time">${time}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    
    // Remove no-messages placeholder if it exists
    const noMessages = messagesContainer.querySelector('.no-messages');
    if (noMessages) {
        noMessages.remove();
    }
    
    // Remove no-chat-selected placeholder if it exists
    const noChatSelected = messagesContainer.querySelector('.no-chat-selected');
    if (noChatSelected) {
        noChatSelected.remove();
    }
    
    // Scroll to bottom
    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 10);
}

// MODIFIED: Send private message to user with duplicate prevention
async function sendPrivateMessageToUser() {
    if (!currentPrivateChatUser) {
        showError('Please select a user to message');
        return;
    }
    
    const input = document.getElementById('private-message-input');
    const content = input.value.trim();
    
    if (!content) return;
    
    const currentUser = currentUserSession?.username;
    
    // ADDED: Check for duplicate message
    const messageKey = `${currentUser}-${currentPrivateChatUser}-${content}`;
    if (lastSentMessages.private[messageKey] && 
        Date.now() - lastSentMessages.private[messageKey] < 3000) { // 3 second cooldown
        console.log('Duplicate private message prevented');
        return;
    }
    
    // ADDED: Track this message
    lastSentMessages.private[messageKey] = Date.now();
    
    try {
        const token = localStorage.getItem('auth_token');
        
        // Send via HTTP or Socket.io
        if (socket) {
            // Send via Socket.io for real-time delivery
            socket.emit('send-private-message-socket', {
                sender_username: currentUser,
                receiver_username: currentPrivateChatUser,
                content: content
            });
        } else {
            // Fallback to HTTP - USING UPDATED ENDPOINT
            const response = await fetch('/api/private/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    sender_username: currentUser,
                    receiver_username: currentPrivateChatUser,
                    content: content
                })
            });
            
            if (!response.ok) throw new Error('Failed to send message');
        }
        
        // Display message immediately for better UX
        displayPrivateUserMessage(content, 'sent', new Date().toISOString(), currentUser);
        
        // Clear input
        input.value = '';
        autoResize(input);
        
        // Disable send button temporarily
        const sendButton = document.getElementById('private-messages-send-button');
        if (sendButton) {
            sendButton.disabled = true;
            sendButton.classList.remove('enabled');
        }
        
        // Update user list to show last message
        loadPrivateUsers();
        
    } catch (error) {
        console.error('Error sending private message:', error);
        showError('Failed to send message');
        
        // Remove from tracking on error
        delete lastSentMessages.private[messageKey];
    }
}

// MODIFIED: Handle new private message with duplicate check
function handleNewPrivateMessage(message) {
    const currentUser = currentUserSession?.username;
    
    // Check if this message is relevant to current user
    if (message.sender_username === currentUser || message.receiver_username === currentUser) {
        
        // ADDED: Check for duplicate display
        const messageKey = `display-${message.sender_username}-${message.receiver_username}-${message.content}`;
        if (lastSentMessages.private[messageKey]) {
            console.log('Duplicate private message display prevented');
            return;
        }
        
        lastSentMessages.private[messageKey] = Date.now();
        
        // If we're in the chat with this user, display the message
        if (currentPrivateChatUser && 
            (currentPrivateChatUser === message.sender_username || 
             currentPrivateChatUser === message.receiver_username)) {
            
            const senderType = message.sender_username === currentUser ? 'sent' : 'received';
            displayPrivateUserMessage(message.content, senderType, message.created_at, message.sender_username);
            
            // Mark as read if we're the receiver
            if (message.receiver_username === currentUser) {
                markMessagesAsRead(message.sender_username);
            }
        }
        
        // Update conversations list
        loadPrivateUsers();
        
        // Show notification if not in chat
        if (message.sender_username !== currentUser && 
            (!currentPrivateChatUser || currentPrivateChatUser !== message.sender_username)) {
            showPrivateMessageNotification(message);
        }
    }
}

// Show notification for new private message
function showPrivateMessageNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`New message from ${message.sender_username}`, {
            body: message.content.length > 50 ? 
                message.content.substring(0, 50) + '...' : message.content,
            icon: 'https://i.pravatar.cc/50?u=' + encodeURIComponent(message.sender_username)
        });
    }
    
    // Update unread badge in menu
    updatePrivateMessagesBadge();
}

// Mark messages as read
async function markMessagesAsRead(senderUsername) {
    const currentUser = currentUserSession?.username;
    
    try {
        const token = localStorage.getItem('auth_token');
        await fetch('/api/private/messages/read', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                sender_username: senderUsername,
                receiver_username: currentUser
            })
        });
        
        // Update UI
        updatePrivateMessagesBadge();
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

// Load unread message counts
async function loadUnreadCounts() {
    const currentUser = currentUserSession?.username;
    if (!currentUser) return;
    
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`/api/private/unread`, {
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });
        if (response.ok) {
            const data = await response.json();
            updatePrivateMessagesBadge(data.unreadCount);
        }
    } catch (error) {
        console.error('Error loading unread counts:', error);
    }
}

// Update private messages badge
function updatePrivateMessagesBadge(count) {
    let badge = document.getElementById('private-messages-badge');
    
    if (!badge) {
        // Create badge if it doesn't exist
        const privateMessagesLink = document.querySelector('a[onclick="showContainer(\'private-messages\')"]');
        if (privateMessagesLink) {
            badge = document.createElement('span');
            badge.id = 'private-messages-badge';
            badge.className = 'menu-badge';
            badge.style.cssText = `
                background: #ff4444;
                color: white;
                border-radius: 10px;
                padding: 2px 6px;
                font-size: 11px;
                margin-left: 5px;
            `;
            privateMessagesLink.appendChild(badge);
        }
    }
    
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }
}

// Setup users search
function setupUsersSearch() {
    const searchInput = document.getElementById('search-users');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const userItems = document.querySelectorAll('.user-item');
            
            userItems.forEach(item => {
                const username = item.dataset.username;
                const displayName = username.toLowerCase();
                
                if (displayName.includes(searchTerm) || username.toLowerCase().includes(searchTerm)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
}

// Show typing indicator for private messages
function showPrivateTypingIndicator(data) {
    const messagesContainer = document.getElementById('private-chat-messages');
    if (!messagesContainer) return;
    
    let typingIndicator = document.getElementById('private-typing-indicator');
    
    if (data.isTyping) {
        if (!typingIndicator) {
            typingIndicator = document.createElement('div');
            typingIndicator.id = 'private-typing-indicator';
            typingIndicator.className = 'typing-indicator';
            typingIndicator.innerHTML = `
                ${data.username} is typing
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            `;
            messagesContainer.appendChild(typingIndicator);
        }
    } else if (typingIndicator) {
        typingIndicator.remove();
    }
    
    // Scroll to bottom when typing
    if (data.isTyping) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Setup private message typing handlers
function setupPrivateMessageTypingHandlers() {
    const input = document.getElementById('private-message-input');
    if (!input || !socket) return;
    
    let typing = false;
    let typingTimer;
    
    input.addEventListener('input', () => {
        const currentUser = currentUserSession?.username;
        if (!currentUser || !currentPrivateChatUser) return;
        
        if (!typing) {
            typing = true;
            socket.emit('private-message-typing-start', {
                sender: currentUser,
                receiver: currentPrivateChatUser,
                isTyping: true
            });
        }
        
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            typing = false;
            socket.emit('private-message-typing-stop', {
                sender: currentUser,
                receiver: currentPrivateChatUser,
                isTyping: false
            });
        }, 1000);
    });
}

// MODIFIED: Function to show users panel and hide chat - SHOW SEARCH CONTAINER
function showUsersPanel() {
    const usersPanel = document.getElementById('users-panel');
    const chatContainer = document.getElementById('private-chat-container');
    const privateMessagesContainer = document.getElementById('private-messages');
    
    if (usersPanel && chatContainer && privateMessagesContainer) {
        usersPanel.classList.remove('hidden');
        chatContainer.classList.remove('active');
        // ADD THIS LINE: Remove class to show the header again
        privateMessagesContainer.classList.remove('private-chat-active');
        
        // SHOW SEARCH CONTAINER AGAIN
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            searchContainer.style.display = 'block';
        }
        
        // Reset header padding
        const privateMessagesHeader = document.querySelector('.private-messages-header');
        if (privateMessagesHeader) {
            privateMessagesHeader.style.padding = '15px';
        }
        
        // Hide chat input
        const chatInput = document.getElementById('private-chat-input');
        if (chatInput) {
            chatInput.style.display = 'none';
        }
        
        // Clear current chat user
        currentPrivateChatUser = null;
        
        // Update header to show we're in users list
        const headerTitle = document.querySelector('.private-messages-header h3');
        if (headerTitle) {
            headerTitle.textContent = 'Private Messages';
        }
        
        // Leave any private chat room
        if (socket) {
            const currentUser = currentUserSession?.username;
            if (currentUser && currentPrivateChatUser) {
                socket.emit('leave-private-chat', { 
                    username: currentUser, 
                    otherUser: currentPrivateChatUser 
                });
            }
        }
    }
}

// MODIFIED: Function to show chat container and hide users panel
function showChatContainer() {
    const usersPanel = document.getElementById('users-panel');
    const chatContainer = document.getElementById('private-chat-container');
    const privateMessagesContainer = document.getElementById('private-messages');
    
    if (usersPanel && chatContainer && privateMessagesContainer) {
        usersPanel.classList.add('hidden');
        chatContainer.classList.add('active');
        // ADD THIS LINE: Add class to hide the header
        privateMessagesContainer.classList.add('private-chat-active');
        
        // Show chat input if we have a user selected
        if (currentPrivateChatUser) {
            const chatInput = document.getElementById('private-chat-input');
            if (chatInput) {
                chatInput.style.display = 'flex';
            }
        }
        
        // ADDED: Adjust padding for private chat messages to prevent hiding
        const privateChatMessages = document.getElementById('private-chat-messages');
        if (privateChatMessages) {
            privateChatMessages.style.paddingBottom = '120px';
        }
    }
}

// ===== ADDED: Function to clear old message tracking data =====
function clearOldMessageTracking() {
    const now = Date.now();
    const maxAge = 60000; // 1 minute
    
    // Clean private messages tracking
    Object.keys(lastSentMessages.private).forEach(key => {
        if (now - lastSentMessages.private[key] > maxAge) {
            delete lastSentMessages.private[key];
        }
    });
    
    // Clean main chat messages tracking
    Object.keys(lastSentMessages.main).forEach(key => {
        if (now - lastSentMessages.main[key] > maxAge) {
            delete lastSentMessages.main[key];
        }
    });
}

// Run cleanup every 30 seconds
setInterval(clearOldMessageTracking, 30000);

// ===== PROFILE MANAGEMENT FUNCTIONS =====
function loadProfile() {
    const username = currentUserSession?.username;
    if (!username) return;
    
    // Load profile from API
    const token = localStorage.getItem('auth_token');
    fetch('/api/user/profile', {
        headers: {
            'Authorization': token ? `Bearer ${token}` : ''
        }
    })
    .then(response => response.json())
    .then(profile => {
        // Populate form fields
        document.getElementById('profile-firstname').value = profile.firstname || '';
        document.getElementById('profile-lastname').value = profile.lastname || '';
        document.getElementById('profile-username').value = profile.username || '';
        document.getElementById('profile-bio').value = profile.bio || '';
        document.getElementById('profile-age').value = profile.age || '';
        document.getElementById('profile-gender').value = profile.gender || '';
        document.getElementById('profile-location').value = profile.location || '';
        document.getElementById('profile-interests').value = profile.interests || '';
        document.getElementById('profile-avatar-img').src = profile.avatar || `https://i.pravatar.cc/150?u=${username}`;
        
        // Update display section
        updateProfileDisplay(profile);
    })
    .catch(error => {
        console.error('Error loading profile:', error);
    });
}

function saveProfile() {
    const username = currentUserSession?.username;
    if (!username) {
        showError('You must be logged in to save profile');
        return;
    }
    
    const profileData = {
        firstname: document.getElementById('profile-firstname').value,
        lastname: document.getElementById('profile-lastname').value,
        username: document.getElementById('profile-username').value,
        bio: document.getElementById('profile-bio').value,
        age: document.getElementById('profile-age').value,
        gender: document.getElementById('profile-gender').value,
        location: document.getElementById('profile-location').value,
        interests: document.getElementById('profile-interests').value,
        avatar: document.getElementById('profile-avatar-img').src
    };
    
    const token = localStorage.getItem('auth_token');
    fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(profileData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update display section
            updateProfileDisplay(profileData);
            
            // Show success message
            showSuccess('Profile updated successfully!');
            
            // Close profile editor after a short delay
            setTimeout(() => {
                hideContainer('profile');
            }, 1500);
        } else {
            throw new Error(data.error || 'Failed to update profile');
        }
    })
    .catch(error => {
        showError(error.message);
    });
}

function updateProfileDisplay(profile) {
    // Update display section in dropdown
    const displayUsername = document.getElementById('display-username');
    const displayBio = document.getElementById('display-bio');
    const displayAvatar = document.getElementById('display-avatar');
    
    if (displayUsername) {
        if (profile.firstname && profile.lastname) {
            displayUsername.textContent = `${profile.firstname} ${profile.lastname}`;
        } else if (profile.firstname) {
            displayUsername.textContent = profile.firstname;
        } else if (profile.lastname) {
            displayUsername.textContent = profile.lastname;
        } else {
            displayUsername.textContent = profile.username;
        }
    }
    
    if (displayBio) {
        displayBio.textContent = profile.bio || 'No bio yet';
    }
    
    if (displayAvatar) {
        displayAvatar.src = profile.avatar;
    }
    
    // Update profile picture in messages if needed
    updateMessageAvatars(profile.avatar);
}

function changeAvatar() {
    const avatarUrl = prompt('Enter the URL for your new profile picture:');
    if (avatarUrl) {
        // Basic URL validation
        if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
            document.getElementById('profile-avatar-img').src = avatarUrl;
        } else {
            showError('Please enter a valid URL starting with http:// or https://');
        }
    }
}

function updateMessageAvatars(avatarUrl) {
    // Update all message avatars for the current user
    const userMessages = document.querySelectorAll('.message.sent .avatar img');
    userMessages.forEach(img => {
        img.src = avatarUrl;
    });
}

// ===== ADDED: USER PROFILE POPUP FUNCTIONS =====
function showUserProfile(username) {
    const popup = document.getElementById('user-profile-popup');
    if (!popup) return;
    
    // Get user profile data from API
    const token = localStorage.getItem('auth_token');
    fetch(`/api/user/profile/${username}`, {
        headers: {
            'Authorization': token ? `Bearer ${token}` : ''
        }
    })
    .then(response => response.json())
    .then(profile => {
        // Set default values
        const defaultProfile = {
            firstname: '',
            lastname: '',
            username: username,
            bio: '',
            age: '',
            gender: '',
            location: '',
            interests: '',
            avatar: `https://i.pravatar.cc/150?u=${username}`
        };
        
        const userProfile = { ...defaultProfile, ...profile };
        
        // Update popup content
        document.getElementById('popup-avatar').src = userProfile.avatar;
        
        // Set display name
        let displayName = username;
        if (userProfile.firstname && userProfile.lastname) {
            displayName = `${userProfile.firstname} ${userProfile.lastname}`;
        } else if (userProfile.firstname) {
            displayName = userProfile.firstname;
        } else if (userProfile.lastname) {
            displayName = userProfile.lastname;
        }
        document.getElementById('popup-username').textContent = displayName;
        
        // Set status (check if user is online)
        const statusDot = document.getElementById('popup-status-dot');
        const statusText = document.getElementById('popup-status-text');
        const isOnline = onlineUsers.includes(username);
        
        statusDot.className = `user-status-indicator ${isOnline ? 'online' : 'offline'}`;
        statusText.textContent = isOnline ? 'Online' : 'Offline';
        
        // Set bio
        document.getElementById('popup-bio').textContent = userProfile.bio || 'No bio available';
        
        // Set details
        document.getElementById('popup-age').textContent = userProfile.age || 'Not specified';
        document.getElementById('popup-gender').textContent = userProfile.gender ? 
            userProfile.gender.charAt(0).toUpperCase() + userProfile.gender.slice(1) : 'Not specified';
        document.getElementById('popup-location').textContent = userProfile.location || 'Not specified';
        document.getElementById('popup-interests').textContent = userProfile.interests || 'Not specified';
        
        // Update message button
        const messageBtn = document.getElementById('popup-message-btn');
        const currentUser = currentUserSession?.username;
        if (username === currentUser) {
            messageBtn.style.display = 'none';
        } else {
            messageBtn.style.display = 'block';
            messageBtn.onclick = () => {
                hideUserProfile();
                // Switch to private messages and open chat with this user
                showContainer('private-messages');
                setTimeout(() => {
                    openPrivateChat(username);
                }, 100);
            };
        }
        
        // Show popup
        popup.style.display = 'flex';
    })
    .catch(error => {
        console.error('Error loading user profile:', error);
        // Fallback to basic profile display
        const popup = document.getElementById('user-profile-popup');
        if (popup) {
            document.getElementById('popup-avatar').src = `https://i.pravatar.cc/150?u=${username}`;
            document.getElementById('popup-username').textContent = username;
            document.getElementById('popup-bio').textContent = 'No bio available';
            document.getElementById('popup-age').textContent = 'Not specified';
            document.getElementById('popup-gender').textContent = 'Not specified';
            document.getElementById('popup-location').textContent = 'Not specified';
            document.getElementById('popup-interests').textContent = 'Not specified';
            
            const messageBtn = document.getElementById('popup-message-btn');
            const currentUser = currentUserSession?.username;
            if (username === currentUser) {
                messageBtn.style.display = 'none';
            } else {
                messageBtn.style.display = 'block';
            }
            
            popup.style.display = 'flex';
        }
    });
}

function hideUserProfile() {
    const popup = document.getElementById('user-profile-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

function messageUser() {
    // This function is called from the popup message button
    // The actual implementation is in showUserProfile function
}

// ===== FIXED: MESSAGE ORDER AND SECTION MANAGEMENT =====

// Initialize socket connection for real-time messaging
function initSocket() {
    console.log('🔌 Initializing socket connection...');
    socket = io();
    
    socket.on('connect', () => {
        console.log('✅ Socket connected');
        const username = currentUserSession?.username;
        if (username) {
            socket.emit('user-online', username);
            // Request existing messages when connecting
            socket.emit('request-messages');
        }
    });

    // Listen for new messages in real-time
    socket.on('new-message', (message) => {
        console.log('💬 New message received via socket:', message);
        
        // Only display if message is from another user or if it's an AI/bot response
        const isOwnMessage = message.username === currentUserSession?.username;
        const isAIResponse = message.username === 'AI' || message.username === 'Bot';
        
        if (!isOwnMessage || isAIResponse) {
            // Check if message already exists to prevent duplicates
            const existingMessage = document.querySelector(`[data-id="${message.id}"]`);
            if (!existingMessage) {
                // Display message immediately
                displayMessage(
                    message.content, 
                    isOwnMessage ? 'sent' : 'received', 
                    message.reply_to, 
                    message.username, 
                    message.id, 
                    true
                );
                
                // Show notification if page is not focused
                if (document.visibilityState !== 'visible' && !isOwnMessage) {
                    showNotification(message.username, message.content);
                }
            }
        }
    });

    // Listen for message history when first connecting
    socket.on('chat-messages', (messages) => {
        console.log('📨 Received message history:', messages.length, 'messages');
        renderMessages(messages);
    });

    // User status updates
    socket.on('user-status-change', (data) => {
        console.log('👤 User status change:', data);
        onlineUsers = data.onlineUsers || [];
        updateOnlineUsersList(onlineUsers);
        updateUserStatusIndicator(data.username, data.status);
    });

    socket.on('user-typing', (data) => {
        showTypingIndicator(data.username, data.isTyping);
    });

    socket.on('disconnect', (reason) => {
        console.log('🔌 Socket disconnected:', reason);
    });

    // Send heartbeat every 2 minutes to stay online
    const heartbeatInterval = setInterval(() => {
        const username = currentUserSession?.username;
        if (username && socket.connected) {
            socket.emit('user-online', username);
            console.log('💓 Heartbeat sent - keeping user online');
        }
    }, 120000); // 2 minutes

    // Cleanup interval on page unload
    window.addEventListener('beforeunload', () => {
        clearInterval(heartbeatInterval);
    });
}

// ===== FIXED: LOAD MESSAGES WITH CORRECT ORDER =====
async function loadMessages() {
    try {
        console.log('📥 Loading messages...');
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/api/messages', {
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });
        if (!response.ok) throw new Error('Failed to load messages');
        const data = await response.json();

        // Check for new messages to show notification
        if (data.length > 0) {
            const latestMessage = data[data.length - 1];
            if (latestMessage.id !== lastMessageId && 
                latestMessage.username !== currentUserSession?.username && 
                document.visibilityState !== 'visible') {
                showNotification(latestMessage.username, latestMessage.content);
            }
            lastMessageId = latestMessage.id;
        }
        
        renderMessages(data);
    } catch (error) {
        console.error('❌ Error loading messages:', error);
        showError('Failed to load messages. Using real-time updates only.');
        // If HTTP fails, rely on socket for real-time messages
        if (socket && socket.connected) {
            socket.emit('request-messages');
        }
    }
}

// ===== FIXED: RENDER MESSAGES WITH CORRECT ORDER =====
function renderMessages(messages) {
    if (!elements.chatContainer) return;
    
    // FIXED: Clear container but maintain scroll position
    elements.chatContainer.innerHTML = '';
    
    // FIXED: Display messages in correct chronological order (oldest to newest)
    messages.forEach(msg => {
        const isOwn = msg.username?.trim().toLowerCase() === currentUserSession?.username?.trim().toLowerCase();
        displayMessage(msg.content, isOwn ? 'sent' : 'received', msg.reply_to, msg.username, msg.id, false);
    });

    // Update scroll state after rendering messages
    setTimeout(updateScrollState, 0);

    // FIXED: IMMEDIATELY scroll to bottom after loading ALL messages
    setTimeout(() => {
        forceScrollToBottom('chat-container');
        // Additional attempts to ensure it works
        setTimeout(() => forceScrollToBottom('chat-container'), 50);
        setTimeout(() => forceScrollToBottom('chat-container'), 100);
    }, 10);
}

// ===== FIXED: MORE RELIABLE SCROLL TO BOTTOM FUNCTION =====
function forceScrollToBottom(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Multiple methods to ensure scrolling works
    const scrollToBottom = () => {
        // Method 1: Direct scroll
        container.scrollTop = container.scrollHeight;
        
        // Method 2: Smooth scroll
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
        
        // Method 3: Alternative approach
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 10);
    };
    
    // Initial scroll
    scrollToBottom();
    
    // Additional attempts to handle dynamic content loading
    setTimeout(scrollToBottom, 50);
    setTimeout(scrollToBottom, 100);
    setTimeout(scrollToBottom, 200);
}

// ===== ENHANCED INITIALIZATION - WITH AUTO-LOGIN =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing application...');
    
    // First, try auto-login
    attemptAutoLogin().then(success => {
        if (!success) {
            // If auto-login fails, show auth container
            console.log('❌ No valid session found, showing login form');
            document.getElementById('auth-container').style.display = 'flex';
            document.querySelector('.menu').style.display = 'none';
            document.querySelector('.news-toggle').style.display = 'none';
        } else {
            console.log('✅ User auto-logged in successfully');
        }
        
        // Initialize buttons
        initializeButtons();
        
        // Load user panel preference
        loadUserPanelPreference();
        
        if ('Notification' in window) {
            Notification.requestPermission().then(permission => {
                notificationPermissionGranted = permission === 'granted';
                console.log('📢 Notification permission:', permission);
            });
        }

        initializeChat();

        // Add scroll event listener for main chat
        if (elements.chatContainer) {
            elements.chatContainer.addEventListener('scroll', updateScrollState);
        }

        // Initialize Private AI input handler
        if (elements.privateInput) {
            elements.privateInput.addEventListener('input', () => {
                autoResize(elements.privateInput);
                const hasText = elements.privateInput.value.trim().length > 0;
                elements.privateSendButton.disabled = !hasText;
                elements.privateSendButton.classList.toggle('enabled', hasText);
            });
            elements.privateInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendPrivateMessage();
                }
            });
        }

        console.log('🎯 Application initialization complete');
    });
});

// ===== FIXED: OVERLAY CLICK HANDLER =====
document.addEventListener('DOMContentLoaded', function() {
    const overlay = document.getElementById('overlay');
    if (overlay) {
        overlay.addEventListener('click', function() {
            console.log('🔘 Overlay clicked - closing all sections');
            // Hide all info containers (INCLUDING PROFILE)
            document.querySelectorAll('.about-container, .features-container, .help-container, .secret-code-container, .sql-editor-container, .profile-container').forEach(container => {
                container.style.display = 'none';
            });
            this.style.display = 'none';
            // Show main chat
            showContainer('chat');
        });
    }

    // Close sections when clicking escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('overlay');
            if (overlay && overlay.style.display === 'block') {
                hideContainer('chat');
            }
        }
    });

    // ADDED: Close user profile popup when clicking outside
    document.addEventListener('click', function(e) {
        const popup = document.getElementById('user-profile-popup');
        if (popup && popup.style.display === 'flex' && e.target === popup) {
            hideUserProfile();
        }
    });
});

// ===== ADDED: Function to setup private messages input handlers =====
function setupPrivateMessageInputHandlers() {
    const input = document.getElementById('private-message-input');
    const sendButton = document.getElementById('private-messages-send-button');
    
    if (input && sendButton) {
        input.addEventListener('input', () => {
            autoResize(input);
            const hasText = input.value.trim().length > 0;
            sendButton.disabled = !hasText;
            sendButton.classList.toggle('enabled', hasText);
            
            // Setup typing indicators for private messages
            setupPrivateMessageTypingHandlers();
        });
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendPrivateMessageToUser();
            }
        });
        
        // Initialize button state
        sendButton.disabled = true;
        sendButton.classList.remove('enabled');
    }
}

// Update online users lists
function updateOnlineUsersList(onlineUsers) {
    console.log('Updating online users list:', onlineUsers);
    
    // Update main chat online list
    updateSingleOnlineList('online-users-list', 'online-count', onlineUsers);
    
    // Update private AI online list
    updateSingleOnlineList('private-online-users-list', 'private-online-count', onlineUsers);
}

function updateSingleOnlineList(listElementId, countElementId, onlineUsers) {
    const onlineList = document.getElementById(listElementId);
    const onlineCount = document.getElementById(countElementId);
    
    if (onlineList) {
        onlineList.innerHTML = '';
        onlineUsers.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'online-user';
            
            // Get user profile to display correct avatar
            const avatarUrl = `https://i.pravatar.cc/50?u=${encodeURIComponent(user)}`;
            
            userElement.innerHTML = `
                <div class="online-user-avatar">
                    <img src="${avatarUrl}" alt="${user}">
                    <div class="online-dot"></div>
                </div>
                <div class="online-user-info">
                    <div class="online-user-name">${user}</div>
                </div>
            `;
            
            // ADDED: Add click event to show user profile
            userElement.onclick = () => {
                showUserProfile(user);
            };
            
            onlineList.appendChild(userElement);
        });
    }
    
    if (onlineCount) {
        onlineCount.textContent = onlineUsers.length;
    }
}

// Remove offline user from the lists
function removeOfflineUser(username) {
    console.log('Removing offline user from UI:', username);
    
    // Remove from main chat online list
    removeUserFromSingleList('online-users-list', 'online-count', username);
    
    // Remove from private AI online list
    removeUserFromSingleList('private-online-users-list', 'private-online-count', username);
    
    // Update status indicator in messages to offline
    updateUserStatusIndicator(username, 'offline');
}

function removeUserFromSingleList(listElementId, countElementId, username) {
    const onlineList = document.getElementById(listElementId);
    if (onlineList) {
        const userElements = onlineList.querySelectorAll('.online-user');
        userElements.forEach(userElement => {
            const userNameElement = userElement.querySelector('.online-user-name');
            if (userNameElement && userNameElement.textContent === username) {
                userElement.remove();
            }
        });
        // Update online count
        const onlineCount = document.getElementById(countElementId);
        if (onlineCount) {
            const currentCount = parseInt(onlineCount.textContent) || 0;
            onlineCount.textContent = Math.max(0, currentCount - 1);
        }
    }
}

// Update status indicator for a specific user
function updateUserStatusIndicator(username, status) {
    // Find all messages from this user and update their status
    const userMessages = document.querySelectorAll(`.message[data-username="${username}"]`);
    userMessages.forEach(msg => {
        let statusIndicator = msg.querySelector('.user-status-indicator');
        if (!statusIndicator) {
            statusIndicator = createStatusIndicator();
            const usernameDiv = msg.querySelector('.username');
            if (usernameDiv) {
                usernameDiv.appendChild(statusIndicator);
            }
        }
        statusIndicator.className = `user-status-indicator ${status}`;
    });
}

// Create a status indicator element
function createStatusIndicator() {
    const indicator = document.createElement('span');
    indicator.className = 'user-status-indicator';
    return indicator;
}

// Show typing indicator
function showTypingIndicator(username, isTyping) {
    let indicator = document.getElementById('typing-indicator');
    if (isTyping) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'typing-indicator';
            indicator.innerHTML = `${username} is typing...`;
            document.getElementById('chat-container').appendChild(indicator);
        }
    } else if (indicator) {
        indicator.remove();
    }
}

// Handle typing events
function setupTypingHandlers() {
    const messageInput = document.getElementById('user-input');
    if (!messageInput) return;
    messageInput.addEventListener('input', () => {
        const username = currentUserSession?.username;
        if (!username || !socket) return;
        if (!isTyping) {
            isTyping = true;
            socket.emit('typing-start', { username });
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            isTyping = false;
            socket.emit('typing-stop', { username });
        }, 1000);
    });
}

// Improved scroll position detection
function checkIfAtBottom(container) {
    if (!container) return true;
    const threshold = 50; // pixels
    const scrollPosition = container.scrollTop + container.clientHeight;
    const scrollHeight = container.scrollHeight;
    return Math.abs(scrollHeight - scrollPosition) <= threshold;
}

// IMPROVED Update scroll state function
function updateScrollState() {
    const chatContainer = document.getElementById('chat-container');
    if (!chatContainer || !scrollToBottomBtn) return;
    
    const scrollTop = chatContainer.scrollTop;
    const scrollHeight = chatContainer.scrollHeight;
    const clientHeight = chatContainer.clientHeight;
    
    // Calculate if we're at the bottom (within 50px threshold)
    const isAtBottomNow = Math.abs(scrollHeight - scrollTop - clientHeight) <= 50;
    
    console.log('Scroll state:', {
        scrollTop,
        scrollHeight, 
        clientHeight,
        isAtBottomNow,
        wasAtBottom: isAtBottom
    });
    
    if (!isAtBottomNow) {
        // User has scrolled up - show the button
        if (!scrollToBottomBtn.classList.contains('visible')) {
            scrollToBottomBtn.style.display = 'flex';
            setTimeout(() => {
                scrollToBottomBtn.classList.add('visible');
            }, 10);
        }
        
        // Update new messages count if we're receiving messages while scrolled up
        if (isAtBottom && !isAtBottomNow) {
            newMessagesCount++;
            if (newMessagesCountEl) {
                newMessagesCountEl.textContent = newMessagesCount;
            }
        }
    } else {
        // User is at bottom - hide the button
        if (scrollToBottomBtn.classList.contains('visible')) {
            scrollToBottomBtn.classList.remove('visible');
            setTimeout(() => {
                scrollToBottomBtn.style.display = 'none';
            }, 300);
        }
        newMessagesCount = 0;
        if (newMessagesCountEl) newMessagesCountEl.textContent = '0';
    }
    
    isAtBottom = isAtBottomNow;
}

// Private AI Go to Top button functions
let privateGoTopBtn;
let privateContainer;
function handlePrivateScroll() {
    if (!privateContainer || !privateGoTopBtn) return;
    const scrollTop = privateContainer.scrollTop;
    // Show button if scrolled more than 200px, else hide
    if (scrollTop > 200) {
        privateGoTopBtn.style.display = 'flex';
        privateGoTopBtn.classList.add('visible');
    } else {
        privateGoTopBtn.style.display = 'none';
        privateGoTopBtn.classList.remove('visible');
    }
}

function scrollPrivateToTop(e) {
    if (e) e.preventDefault();
    if (privateContainer) {
        privateContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Page visibility and unload handlers
function handleVisibilityChange() {
    const username = currentUserSession?.username;
    if (username && socket) {
        if (document.visibilityState === 'hidden') {
            // User switched tabs or minimized browser - mark as away
            socket.emit('user-away', username);
        } else {
            // User came back to the tab - mark as online
            socket.emit('user-online', username);
        }
    }
}

function handleBeforeUnload() {
    const username = currentUserSession?.username;
    if (username && socket) {
        // Send away status instead of offline
        socket.emit('user-away', username);
    }
}

function handlePageHide() {
    const username = currentUserSession?.username;
    if (username && socket) {
        // Send away status instead of offline
        socket.emit('user-away', username);
    }
}

// Format message time function
function formatMessageTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // If less than a minute ago
    if (diff < 60000) {
        return 'Just now';
    }
    
    // If less than an hour ago
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }
    
    // If today
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // If yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    }
    
    // Otherwise, show date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// SQL EDITOR FUNCTIONS
function initializeSQLEditor() {
    const sqlTextarea = document.getElementById('sql-textarea');
    const runSqlBtn = document.getElementById('run-sql');
    const saveSqlBtn = document.getElementById('save-sql');
    const clearSqlBtn = document.getElementById('clear-sql');
    const sqlResultsDiv = document.getElementById('sql-results');
    const savedQueriesList = document.getElementById('saved-queries-list');

    if (runSqlBtn) {
        runSqlBtn.addEventListener('click', executeSQL);
    }
    
    if (saveSqlBtn) {
        saveSqlBtn.addEventListener('click', saveSQLQuery);
    }
    
    if (clearSqlBtn) {
        clearSqlBtn.addEventListener('click', clearSQLEditor);
    }

    // Load saved queries
    loadSavedQueries();
}

function executeSQL() {
    const sqlTextarea = document.getElementById('sql-textarea');
    const sqlResultsDiv = document.getElementById('sql-results');
    
    if (!sqlTextarea || !sqlResultsDiv) return;
    
    const query = sqlTextarea.value.trim();
    
    if (!query) {
        showSQLResult('Please enter a SQL query', 'error');
        return;
    }

    // Simulate SQL execution with sample data
    const result = simulateSQLExecution(query);
    displaySQLResult(result);
}

function simulateSQLExecution(query) {
    // Sample database for demonstration
    const sampleDatabase = {
        users: [
            { id: 1, username: 'john_doe', email: 'john@example.com', status: 'active', created_at: '2024-01-15' },
            { id: 2, username: 'jane_smith', email: 'jane@example.com', status: 'active', created_at: '2024-01-16' },
            { id: 3, username: 'bob_wilson', email: 'bob@example.com', status: 'inactive', created_at: '2024-01-17' },
            { id: 4, username: 'alice_brown', email: 'alice@example.com', status: 'active', created_at: '2024-01-18' }
        ],
        messages: [
            { id: 1, user_id: 1, content: 'Hello everyone!', timestamp: '2024-01-15 10:30:00' },
            { id: 2, user_id: 2, content: 'Hi John!', timestamp: '2024-01-15 10:35:00' },
            { id: 3, user_id: 1, content: 'How are you?', timestamp: '2024-01-15 10:40:00' },
            { id: 4, user_id: 3, content: 'Good morning!', timestamp: '2024-01-16 09:15:00' }
        ]
    };

    try {
        const upperQuery = query.toUpperCase();
        
        // Basic SQL simulation
        if (upperQuery.includes('SELECT')) {
            if (upperQuery.includes('FROM USERS')) {
                if (upperQuery.includes('WHERE')) {
                    if (upperQuery.includes("STATUS = 'ACTIVE'")) {
                        return {
                            success: true,
                            data: sampleDatabase.users.filter(user => user.status === 'active'),
                            columns: ['id', 'username', 'email', 'status', 'created_at'],
                            rowCount: sampleDatabase.users.filter(user => user.status === 'active').length
                        };
                    }
                    if (upperQuery.includes("USERNAME LIKE 'J%'")) {
                        return {
                            success: true,
                            data: sampleDatabase.users.filter(user => user.username.toLowerCase().startsWith('j')),
                            columns: ['id', 'username', 'email', 'status', 'created_at'],
                            rowCount: sampleDatabase.users.filter(user => user.username.toLowerCase().startsWith('j')).length
                        };
                    }
                }
                return {
                    success: true,
                    data: sampleDatabase.users,
                    columns: ['id', 'username', 'email', 'status', 'created_at'],
                    rowCount: sampleDatabase.users.length
                };
            }
            if (upperQuery.includes('FROM MESSAGES')) {
                return {
                    success: true,
                    data: sampleDatabase.messages,
                    columns: ['id', 'user_id', 'content', 'timestamp'],
                    rowCount: sampleDatabase.messages.length
                };
            }
            if (upperQuery.includes('COUNT(*)')) {
                return {
                    success: true,
                    data: [{ count: sampleDatabase.users.length }],
                    columns: ['count'],
                    rowCount: 1
                };
            }
        }
        
        if (upperQuery.includes('INSERT INTO')) {
            return {
                success: true,
                message: 'Query executed successfully. 1 row affected.',
                rowCount: 1
            };
        }
        
        if (upperQuery.includes('UPDATE')) {
            return {
                success: true,
                message: 'Query executed successfully. 1 row affected.',
                rowCount: 1
            };
        }
        
        if (upperQuery.includes('DELETE FROM')) {
            return {
                success: true,
                message: 'Query executed successfully. 1 row affected.',
                rowCount: 1
            };
        }
        
        return {
            success: false,
            error: 'Unsupported SQL operation or syntax error'
        };
        
    } catch (error) {
        return {
            success: false,
            error: 'SQL syntax error: ' + error.message
        };
    }
}

function displaySQLResult(result) {
    const sqlResultsDiv = document.getElementById('sql-results');
    if (!sqlResultsDiv) return;
    
    sqlResultsDiv.innerHTML = '';
    
    if (result.success) {
        if (result.data) {
            // Display data in table format
            const table = document.createElement('table');
            table.className = 'sql-result-table';
            
            // Create header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            result.columns.forEach(column => {
                const th = document.createElement('th');
                th.textContent = column;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);
            
            // Create body
            const tbody = document.createElement('tbody');
            result.data.forEach(row => {
                const tr = document.createElement('tr');
                result.columns.forEach(column => {
                    const td = document.createElement('td');
                    td.textContent = row[column] || '';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            
            sqlResultsDiv.appendChild(table);
            
            // Show row count
            const rowCount = document.createElement('div');
            rowCount.className = 'sql-row-count';
            rowCount.textContent = `Rows returned: ${result.rowCount}`;
            sqlResultsDiv.appendChild(rowCount);
        } else if (result.message) {
            const message = document.createElement('div');
            message.className = 'sql-success-message';
            message.textContent = result.message;
            sqlResultsDiv.appendChild(message);
        }
    } else {
        const error = document.createElement('div');
        error.className = 'sql-error-message';
        error.textContent = 'Error: ' + result.error;
        sqlResultsDiv.appendChild(error);
    }
}

function showSQLResult(message, type) {
    const sqlResultsDiv = document.getElementById('sql-results');
    if (!sqlResultsDiv) return;
    
    const div = document.createElement('div');
    div.className = type === 'error' ? 'sql-error-message' : 'sql-success-message';
    div.textContent = message;
    sqlResultsDiv.appendChild(div);
}

function saveSQLQuery() {
    const sqlTextarea = document.getElementById('sql-textarea');
    if (!sqlTextarea) return;
    
    const query = sqlTextarea.value.trim();
    if (!query) {
        showSQLResult('Cannot save empty query', 'error');
        return;
    }
    
    const queryName = prompt('Enter a name for this query:');
    if (!queryName) return;
    
    const newQuery = {
        id: Date.now(),
        name: queryName,
        query: query,
        createdAt: new Date().toISOString()
    };
    
    savedQueries.push(newQuery);
    localStorage.setItem('savedQueries', JSON.stringify(savedQueries));
    
    loadSavedQueries();
    showSQLResult(`Query "${queryName}" saved successfully!`, 'success');
}

function loadSavedQueries() {
    const savedQueriesList = document.getElementById('saved-queries-list');
    if (!savedQueriesList) return;
    
    savedQueriesList.innerHTML = '';
    
    if (savedQueries.length === 0) {
        savedQueriesList.innerHTML = '<div class="no-queries">No saved queries</div>';
        return;
    }
    
    savedQueries.forEach(query => {
        const queryItem = document.createElement('div');
        queryItem.className = 'saved-query-item';
        queryItem.innerHTML = `
            <div class="query-name">${query.name}</div>
            <div class="query-actions">
                <button onclick="loadQuery(${query.id})" class="query-btn load-btn">Load</button>
                <button onclick="deleteQuery(${query.id})" class="query-btn delete-btn">Delete</button>
            </div>
        `;
        savedQueriesList.appendChild(queryItem);
    });
}

function loadQuery(queryId) {
    const query = savedQueries.find(q => q.id === queryId);
    if (!query) return;
    
    const sqlTextarea = document.getElementById('sql-textarea');
    if (sqlTextarea) {
        sqlTextarea.value = query.query;
    }
    
    showSQLResult(`Loaded query: ${query.name}`, 'success');
}

function deleteQuery(queryId) {
    if (!confirm('Are you sure you want to delete this query?')) return;
    
    savedQueries = savedQueries.filter(q => q.id !== queryId);
    localStorage.setItem('savedQueries', JSON.stringify(savedQueries));
    
    loadSavedQueries();
    showSQLResult('Query deleted successfully', 'success');
}

function clearSQLEditor() {
    const sqlTextarea = document.getElementById('sql-textarea');
    const sqlResultsDiv = document.getElementById('sql-results');
    
    if (sqlTextarea) sqlTextarea.value = '';
    if (sqlResultsDiv) sqlResultsDiv.innerHTML = '';
}

// SECRET CODE FUNCTIONS
function hasVerifiedCode() {
    return sessionStorage.getItem('secretCodeVerified') === 'true';
}

function isUserLockedOut() {
    const lockoutUntil = localStorage.getItem('lockoutUntil');
    if (lockoutUntil && Date.now() < parseInt(lockoutUntil)) {
        return true;
    }
    // Clear lockout if time has passed
    if (lockoutUntil) {
        localStorage.removeItem('lockoutUntil');
        localStorage.removeItem('failedAttempts');
    }
    return false;
}

function initializeSecretCodeVerification() {
    const secretCodeInput = document.getElementById('secret-code-input');
    const verifyBtn = document.getElementById('verify-code-btn');

    if (secretCodeInput) {
        secretCodeInput.addEventListener('input', function() {
            // Enable/disable button based on input
            verifyBtn.disabled = this.value.trim().length === 0;
            
            // Clear error when user starts typing again
            if (this.value.trim().length > 0) {
                hideSecretCodeError();
                hideSecretCodeSuccess();
            }
        });

        // Allow pressing Enter to submit
        secretCodeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !verifyBtn.disabled) {
                verifySecretCode();
            }
        });

        // Focus on input when container is shown
        secretCodeInput.addEventListener('focus', function() {
            this.select();
        });
    }

    // Check if user is locked out
    if (isUserLockedOut()) {
        showLockoutMessage();
    } else {
        // Get failed attempts from localStorage
        failedAttempts = parseInt(localStorage.getItem('failedAttempts')) || 0;
        if (failedAttempts > 0) {
            showAttemptsWarning();
        }
    }
}

function verifySecretCode() {
    if (isLockedOut) return;

    const secretCodeInput = document.getElementById('secret-code-input');
    const enteredCode = secretCodeInput.value.trim();
    
    if (!enteredCode) {
        showSecretCodeError('Please enter a code');
        return;
    }

    if (enteredCode === SECRET_CODE) {
        // Success
        showSecretCodeSuccess('Code verified successfully! Access to SQL Editor granted.');
        sessionStorage.setItem('secretCodeVerified', 'true');
        
        // Reset failed attempts
        failedAttempts = 0;
        localStorage.removeItem('failedAttempts');
        localStorage.removeItem('lockoutUntil');
        
        // Hide warnings
        hideAttemptsWarning();
        hideLockoutMessage();
        
        // Disable input and button
        secretCodeInput.disabled = true;
        document.getElementById('verify-code-btn').disabled = true;
        
        // Enable SQL Editor access
        enableSQLEditorAccess();
        
        console.log('Secret code verified successfully! SQL Editor access granted.');
        
    } else {
        // Failed attempt
        failedAttempts++;
        localStorage.setItem('failedAttempts', failedAttempts.toString());
        
        if (failedAttempts >= MAX_ATTEMPTS) {
            // Lock user out
            const lockoutDuration = 5 * 60 * 1000; // 5 minutes
            const lockoutUntil = Date.now() + lockoutDuration;
            localStorage.setItem('lockoutUntil', lockoutUntil.toString());
            isLockedOut = true;
            showLockoutMessage();
        } else {
            showSecretCodeError('Invalid code. Please try again.');
            showAttemptsWarning();
        }
    }
}

function enableSQLEditorAccess() {
    // Add SQL Editor to menu if not already there
    const dropdown = document.getElementById('dropdown');
    if (dropdown) {
        // Check if SQL Editor menu item already exists
        const existingSqlItem = dropdown.querySelector('a[onclick="showContainer(\'sql-editor-container\')"]');
        if (!existingSqlItem) {
            const sqlMenuItem = document.createElement('a');
            sqlMenuItem.href = '#';
            sqlMenuItem.onclick = function() { showContainer('sql-editor-container'); return false; };
            sqlMenuItem.innerHTML = '🔍 SQL Editor';
            
            // Insert after Secret Code menu item
            const secretCodeItem = dropdown.querySelector('a[onclick="showContainer(\'secret-code\')"]');
            if (secretCodeItem) {
                secretCodeItem.parentNode.insertBefore(sqlMenuItem, secretCodeItem.nextSibling);
            } else {
                dropdown.appendChild(sqlMenuItem);
            }
        }
    }
}

function showLockoutMessage() {
    const lockoutMessage = document.getElementById('lockout-message');
    const lockoutTime = document.getElementById('lockout-time');
    const lockoutUntil = parseInt(localStorage.getItem('lockoutUntil'));
    
    if (lockoutUntil) {
        const minutesLeft = Math.ceil((lockoutUntil - Date.now()) / (60 * 1000));
        lockoutTime.textContent = minutesLeft;
        lockoutMessage.style.display = 'block';
        
        // Set timeout to clear lockout
        setTimeout(() => {
            isLockedOut = false;
            localStorage.removeItem('lockoutUntil');
            localStorage.removeItem('failedAttempts');
            failedAttempts = 0;
            hideLockoutMessage();
            hideAttemptsWarning();
        }, lockoutUntil - Date.now());
    }
}

function hideLockoutMessage() {
    const lockoutMessage = document.getElementById('lockout-message');
    if (lockoutMessage) lockoutMessage.style.display = 'none';
}

function showAttemptsWarning() {
    const attemptsWarning = document.getElementById('attempts-warning');
    const attemptsLeft = document.getElementById('attempts-left');
    if (attemptsWarning && attemptsLeft) {
        attemptsLeft.textContent = MAX_ATTEMPTS - failedAttempts;
        attemptsWarning.style.display = 'block';
    }
}

function hideAttemptsWarning() {
    const attemptsWarning = document.getElementById('attempts-warning');
    if (attemptsWarning) attemptsWarning.style.display = 'none';
}

function showSecretCodeError(message) {
    const errorElement = document.getElementById('secret-code-error');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
}

function hideSecretCodeError() {
    const errorElement = document.getElementById('secret-code-error');
    if (errorElement) errorElement.style.display = 'none';
}

function showSecretCodeSuccess(message) {
    const successElement = document.getElementById('secret-code-success');
    if (successElement) {
        successElement.textContent = message;
        successElement.style.display = 'block';
    }
}

function hideSecretCodeSuccess() {
    const successElement = document.getElementById('secret-code-success');
    if (successElement) successElement.style.display = 'none';
}

function resetSecretCodeForm() {
    const secretCodeInput = document.getElementById('secret-code-input');
    const verifyBtn = document.getElementById('verify-code-btn');
    
    if (secretCodeInput) {
        secretCodeInput.value = '';
        secretCodeInput.disabled = false;
    }
    
    if (verifyBtn) {
        verifyBtn.disabled = false;
    }
    
    hideSecretCodeError();
    hideSecretCodeSuccess();
    hideAttemptsWarning();
    hideLockoutMessage();
}

// Initialize username validation
document.addEventListener('DOMContentLoaded', function() {
    setupUsernameValidation();
});

function setupUsernameValidation() {
    const usernameInput = document.getElementById('auth-username');
    if (!usernameInput) return;
    
    let validationTimer;
    
    usernameInput.addEventListener('input', function() {
        clearTimeout(validationTimer);
        const username = this.value.trim();
        
        // Clear previous validation states
        this.classList.remove('username-valid', 'username-invalid');
        elements.errorDisplay.style.display = 'none';
        
        if (username.length < 3) return;
        
        validationTimer = setTimeout(async () => {
            // Validate username format
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                this.classList.add('username-invalid');
                return;
            }
            
            // Only check availability during signup
            if (!isLogin) {
                try {
                    const response = await fetch('/api/auth/check-username', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ username: username })
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        if (data.available) {
                            this.classList.add('username-valid');
                        } else {
                            this.classList.add('username-invalid');
                            showError('Username already exists');
                        }
                    }
                } catch (error) {
                    console.error('Error checking username:', error);
                }
            }
        }, 500);
    });
}

// UPDATED function to update the profile section with new design
function updateProfileSection() {
    const dropdown = document.getElementById('dropdown');
    if (!dropdown) return;
    
    const currentUsername = currentUserSession?.username;
    
    // Remove existing profile section if it exists
    const existingProfile = document.querySelector('.profile-section');
    const existingDivider = document.querySelector('.menu-divider');
    if (existingProfile) existingProfile.remove();
    if (existingDivider) existingDivider.remove();
    
    // Only add profile section if user is logged in
    if (currentUsername) {
        const profileSection = document.createElement('div');
        profileSection.className = 'profile-panel';
        profileSection.innerHTML = `
            <div class="profile-avatar">
                <img src="https://i.pravatar.cc/50?u=${encodeURIComponent(currentUsername)}" alt="Profile">
            </div>
            <div class="profile-info">
                <div class="profile-username">${currentUsername}</div>
                <div class="profile-status online">
                    <span class="status-dot"></span>
                    <span>Online</span>
                </div>
            </div>
        `;
        
        const divider = document.createElement('div');
        divider.className = 'menu-divider';
        
        // Insert at the beginning of dropdown
        dropdown.insertBefore(divider, dropdown.firstChild);
        dropdown.insertBefore(profileSection, dropdown.firstChild);
    }
}

// Improved click handler for dropdown
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('dropdown');
    const hamburger = document.querySelector('.hamburger');
    const kebabMenu = document.querySelector('.kebab-menu');
    
    // Close dropdown if clicking outside of it and not on menu controls
    if (dropdown && dropdown.style.display === 'block' && 
        !dropdown.contains(event.target) && 
        event.target !== hamburger &&
        !kebabMenu.contains(event.target)) {
        dropdown.style.display = 'none';
    }
    
    // Close kebab menu if clicking outside
    const kebabDropdown = document.querySelector('.kebab-dropdown');
    if (kebabDropdown && kebabDropdown.classList.contains('active') && 
        !kebabMenu.contains(event.target) && 
        !kebabDropdown.contains(event.target)) {
        kebabDropdown.classList.remove('active');
    }
});

// NEWS FUNCTIONS
function toggleNews() {
    const newsContainer = document.getElementById('news-container');
    if (newsContainer) {
        // Toggle the display of the news container
        if (newsContainer.style.display === 'none' || newsContainer.style.display === '') {
            newsContainer.style.display = 'block';
            // Make sure it's populated with news items
            populateNews();
        } else {
            newsContainer.style.display = 'none';
        }
    }
}

const sampleNews = [
    {
        title: "New AI Features Released",
        description: "We've added exciting new capabilities to our chatbot!",
        date: "2025-01-15"
    },
    {
        title: "System Update",
        description: "Performance improvements and bug fixes",
        date: "2025-03-14"
    },
    {
        title: "Maintenance Notice",
        description: "Scheduled maintenance on January 20th",
        date: "2025-03-13"
    }
];

function populateNews() {
    const newsItems = document.getElementById('news-items');
    if (!newsItems) return;
    
    newsItems.innerHTML = '';

    sampleNews.forEach(news => {
        const newsItem = document.createElement('div');
        newsItem.className = 'news-item';
        newsItem.innerHTML = `
            <h3>${news.title}</h3>
            <p>${news.description}</p>
            <small>${news.date}</small>
        `;
        newsItems.appendChild(newsItem);
    });
}

// --- CUT HERE ---
document.addEventListener('click', function (e) {
    if (e.target.tagName === 'IMG' && e.target.closest('.message')) {
        openZoom(e.target.src);
    }
});

function openZoom(src) {
    document.body.style.overflow = 'hidden';
    const overlay = document.getElementById('zoom-overlay');
    const zoomImage = document.getElementById('zoom-image');
    const downloadBtn = document.getElementById('download-btn');

    if (!overlay || !zoomImage || !downloadBtn) return;
    
    zoomImage.src = src;

    // Force download filename
    downloadBtn.href = src;
    downloadBtn.setAttribute('download', 'image.jpg');

    overlay.style.display = 'flex';
}

function closeZoom() {
    document.body.style.overflow = '';
    const overlay = document.getElementById('zoom-overlay');
    if (overlay) overlay.style.display = 'none';
}

if (document.getElementById("year")) {
    document.getElementById("year").textContent = new Date().getFullYear();
}
// --- CUT HERE ---
// Zoom functions remain the same
function openZoom(src) {
    document.body.style.overflow = 'hidden';
    const overlay = document.getElementById('zoom-overlay');
    const zoomImage = document.getElementById('zoom-image');
    if (!overlay || !zoomImage) return;
    
    zoomImage.src = src;
    overlay.style.display = 'flex';
}

function closeZoom() {
    document.body.style.overflow = '';
    const overlay = document.getElementById('zoom-overlay');
    if (overlay) overlay.style.display = 'none';
}
// Initialize if user is logged in
const currentUser = currentUserSession?.username;
if (currentUser) {
    showContainer('chat');
    
    const chatInput = document.querySelector('.chat-input');
    if (chatInput) chatInput.style.display = 'flex';
    
    updateProfileSection();
    
    // Initialize real-time features
    initSocket();
    setupTypingHandlers();
    
    // Add page event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    
    // Enable SQL Editor access if already verified
    if (hasVerifiedCode()) {
        enableSQLEditorAccess();
    }
}

// Format message time function
function formatMessageTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // If less than a minute ago
    if (diff < 60000) {
        return 'Just now';
    }
    
    // If less than an hour ago
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }
    
    // If today
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // If yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    }
    
    // Otherwise, show date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
