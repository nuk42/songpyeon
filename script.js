import gameRecorder from './gameRecorder.js';
document.addEventListener('DOMContentLoaded', () => {

    // --- Constants & State ---
    const practiceToggle = document.getElementById('practice-toggle');
    const fullscreenToggle = document.getElementById('fullscreen-toggle');
    const practiceSettings = document.getElementById('practice-settings');
    const nicknameSettings = document.getElementById('nickname-settings');
    const nicknameInput = document.getElementById('nickname-input');
    const linesInput = document.getElementById('lines-input');
    const timeInput = document.getElementById('time-input');
    const choiceButtons = document.querySelectorAll('.choice-button');
    const mainContent = document.querySelector('.main-content');
    const footerSettings = document.querySelector('.footer-settings');
    const gameScreen = document.getElementById('game-screen');
    const loadingOverlay = document.getElementById('loading-overlay');
    const rankingScreen = document.getElementById('ranking-screen');
    const rankingButton = document.getElementById('ranking-button');
    const backToMainButton = document.getElementById('back-to-main-button');
    const rankingButtonContainer = document.querySelector('.ranking-button-container');

    let isPracticeMode = true;
    let isMashPracticeMode = false;
    let longPressTimer = null;
    let mashSuccessTimer = null;
    let lastValidLines, lastValidTime;
    let gamePattern = [];
    let currentRound = 0; // Added currentRound variable

    let patternManifest = {};
    let difficultyConfig = {};
    let roundConfig = {}; // Added roundConfig

    let currentGameIndex = 0;
    let gameFailed = false;
    let currentRole = null;
    let roundTimer = null;
    let roundStartTime = 0;
    let glowAnimationInterval = null;
    let missAnimationInterval = null;
    let scrollAnimationId = null;
    let nextRoundTimeoutId = null;
    let isReplaying = false;
    let replayEvents = [];
    let nextReplayEventTimeout = null;
    let replayRoundStartTime = 0;
    const pigGlowFrames = Array.from({length: 10}, (_, i) => `res/thanksgiving_pig_command_glow${String(i).padStart(2, '0')}.png`);
    const rabbitGlowFrames = Array.from({length: 10}, (_, i) => `res/thanksgiving_rabbit_command_glow${String(i).padStart(2, '0')}.png`);
    const pigMissFrames = Array.from({length: 16}, (_, i) => `res/thanksgiving_room_miss_pig${i}.png`);
    const rabbitMissFrames = Array.from({length: 16}, (_, i) => `res/thanksgiving_room_miss_rabbit${i}.png`);

    // --- Keybinding State ---
    let isBindingKey = false;
    let commandToBind = null;
    let keybinds = {};
    let commandBinds = {};
    let botConfig = {};
    let botActionTimeout = null;
    let assetMap = {};
    let tteokDifficultyConfig = {};
    let defaultRabbitTransformProbabilityFactor = 0.7;
    let playerLives = 5;
    let lifeLostInPreviousRound = false;
    let lifeLostInReplayRound = false;

    // =================================================================
    // SECTION 1: CORE HELPER FUNCTIONS
    // =================================================================

    const preloadImages = (urls) => {
        return Promise.all(urls.map(url => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.src = url;
                img.onload = resolve;
                img.onerror = reject;
            });
        }));
    };

    const showToast = (message) => {
        const existingToast = document.querySelector('.toast-message');
        if (existingToast) existingToast.remove();
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.className = 'toast-message';
        document.body.appendChild(toast);
        setTimeout(() => { toast.classList.add('show'); }, 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { if (toast.parentElement) toast.remove(); }, 500);
        }, 2000);
    };

    const patternGenerator = {
        pigNormalIcons: [1, 2, 3],
        pigSpecialIcon: 6,
        rabbitNormalIcons: [4, 5, 7],
        rabbitSpecialIcon: 8,
        generatePigPair(p){p.push(this.pigNormalIcons[Math.floor(Math.random()*this.pigNormalIcons.length)]);p.push(this.pigSpecialIcon);},
        generateRabbitPair(p){if(Math.random()<0.5){p.push(this.rabbitSpecialIcon);p.push(this.rabbitSpecialIcon);}else{p.push(this.rabbitNormalIcons[Math.floor(Math.random()*this.rabbitNormalIcons.length)]);p.push(this.rabbitNormalIcons[Math.floor(Math.random()*this.rabbitNormalIcons.length)]);}},
        generateFullPattern(totalCount,role=null){const p=[];const pairs=totalCount/2;const rm={'돼지':'Pig','토끼':'Rabbit'};const gr=rm[role]||null;if(gr===null){for(let i=0;i<pairs;i++){if(Math.random()<0.5){this.generatePigPair(p);}else{this.generateRabbitPair(p);}}}else if(gr==='Pig'){for(let i=0;i<pairs;i++)this.generatePigPair(p);}else if(gr==='Rabbit'){for(let i=0;i<pairs;i++)this.generateRabbitPair(p);}const fp=[];for(let i=0;i<p.length;i+=6){fp.push(p.slice(i,i+6));}return fp;}
    };

    // =================================================================
    // SECTION 2: KEYBINDING FUNCTIONS
    // =================================================================

    const loadKeybinds = () => {
        commandBinds = JSON.parse(localStorage.getItem('keyBinds') || '{}');
    };

    const saveKeybinds = () => {
        localStorage.setItem('keyBinds', JSON.stringify(commandBinds));
    };

    const rebuildRoleKeybinds = (role) => {
        keybinds = {};
        const roleBinds = commandBinds[role] || {};
        for (const command in roleBinds) {
            const key = roleBinds[command];
            keybinds[key] = command;
        }
    };

    const getDisplayKey = (key) => {
        if (key === ' ') return 'SPACE';
        return key.toUpperCase();
    };

    const updateKeybindDisplays = () => {
        const roleBinds = commandBinds[currentRole] || {};
        document.querySelectorAll('.keybind-overlay').forEach(overlay => {
            const command = overlay.dataset.commandForBind;
            overlay.textContent = (command && roleBinds[command]) ? getDisplayKey(roleBinds[command]) : '-';
            overlay.classList.remove('waiting');
        });
    };

    const startKeyBinding = (event) => {
        event.stopPropagation();
        const overlay = event.currentTarget;
        const command = overlay.dataset.commandForBind;
        if (!command) return;
        updateKeybindDisplays();
        isBindingKey = true;
        commandToBind = command;
        overlay.textContent = '...';
        overlay.classList.add('waiting');
    };

    // =================================================================
    // SECTION 3: GAME LOGIC & UI RENDERING
    // =================================================================

    const showMissAnimation = () => {
        const missFrames = (currentRole === '돼지') ? pigMissFrames : rabbitMissFrames;
        const overlays = document.querySelectorAll('.miss-overlay');
        let frame = 0;

        for (let i = currentGameIndex; i < gamePattern.length; i++) {
            if(overlays[i]) overlays[i].classList.remove('hidden');
        }

        missAnimationInterval = setInterval(() => {
            if (frame >= missFrames.length) {
                clearInterval(missAnimationInterval);
                return;
            }
            for (let i = currentGameIndex; i < gamePattern.length; i++) {
                if(overlays[i]) overlays[i].src = missFrames[frame];
            }
            frame++;
        }, 60);
    };

    const updateGlowIndicator = () => {
        if (glowAnimationInterval) clearInterval(glowAnimationInterval);

        const glowElement = gameScreen.querySelector('.glow-indicator');
        if (!glowElement) return;

        if (currentGameIndex >= gamePattern.length) {
            glowElement.classList.add('hidden');
            return;
        }

        const allIconWrappers = document.querySelectorAll('.command-icon-wrapper');
        const targetIconWrapper = allIconWrappers[currentGameIndex];
        if (!targetIconWrapper) {
            glowElement.classList.add('hidden');
            return;
        }

        const gameAreaRect = gameScreen.querySelector('.game-area').getBoundingClientRect();
        const iconRect = targetIconWrapper.getBoundingClientRect();

        const top = iconRect.top - gameAreaRect.top + (iconRect.height / 2);
        const left = iconRect.left - gameAreaRect.left + (iconRect.width / 2);

        glowElement.style.top = `${top}px`;
        glowElement.style.left = `${left}px`;

        const currentCommandId = gamePattern[currentGameIndex];
        const isPigCommand = [1, 2, 3, 6].includes(currentCommandId);
        const glowFrames = isPigCommand ? pigGlowFrames : rabbitGlowFrames;

        glowElement.src = glowFrames[0];
        glowElement.classList.remove('hidden');

        let frame = 1;
        glowAnimationInterval = setInterval(() => {
            glowElement.src = glowFrames[frame];
            frame = (frame + 1) % glowFrames.length;
        }, 80);
    };

    const positionGlowReliably = () => {
        const allIconWrappers = document.querySelectorAll('.command-icon-wrapper');
        if (allIconWrappers.length === 0) {
            requestAnimationFrame(positionGlowReliably);
            return;
        }
        const targetIconWrapper = allIconWrappers[0];
        const iconRect = targetIconWrapper.getBoundingClientRect();

        if (iconRect.width === 0 || iconRect.height === 0) {
            requestAnimationFrame(positionGlowReliably);
            return;
        }

        updateGlowIndicator();
    };

    const updateHeartDisplay = () => {
        const heartIcons = document.querySelectorAll('#heart-container .heart-icon');
        for (let i = 0; i < heartIcons.length; i++) {
            if (i < playerLives) {
                heartIcons[i].src = 'res/thanksgiving_room_heart.png';
            } else {
                heartIcons[i].src = 'res/thanksgiving_room_heart_off.png';
            }
        }
    };

    const onGameOver = () => {
        if (roundTimer) clearTimeout(roundTimer);
        if (botActionTimeout) clearTimeout(botActionTimeout);
        if (glowAnimationInterval) clearInterval(glowAnimationInterval);
        if (missAnimationInterval) clearInterval(missAnimationInterval);

        if (gameRecorder.isRecording()) {
            const nickname = nicknameInput.value.trim();
            if (!nickname) {
                gameRecorder.stop();
                alert(`게임 결과: ${currentRound} 라운드\n(닉네임이 없어 기록이 저장되지 않았습니다.)`);
                showMainScreen();
                return; // Exit without saving
            }

            const gameData = gameRecorder.getRecording();

            fetch('https://ranking-three-kappa.vercel.app/api/save-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ nickname, data: gameData }),
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => { throw new Error(err.error || `HTTP error! status: ${response.status}`) });
                }
                return response.json();
            })
            .then(data => {
                console.log('Game data saved successfully:', data);
                // showToast('게임 기록이 저장되었습니다.');
            })
            .catch(error => {
                console.error('Error saving game data:', error.message);
                // showToast(`게임 기록 저장 실패: ${error.message}`);
            });

            gameRecorder.stop();
        }

        alert(`게임 결과: ${currentRound} 라운드`);
        showMainScreen();
    };

    const startNewRound = () => {
        if (roundTimer) clearTimeout(roundTimer);
        // Add life deduction logic here
        if (!isPracticeMode && !isMashPracticeMode && lifeLostInPreviousRound) {
            playerLives--;
            updateHeartDisplay();
            if (playerLives <= 0) {
                onGameOver();
                return; // Stop if game over
            }
            lifeLostInPreviousRound = false; // Reset flag
        }
        showGameScreen(currentRole);
    };



    const onRoundEnd = (isSuccess) => {
        if (gameRecorder.isRecording()) {
            gameRecorder.add('O', isSuccess ? 'success' : 'fail');
        }
        if (roundTimer) clearTimeout(roundTimer);
        if (botActionTimeout) clearTimeout(botActionTimeout);
        gameFailed = true;

        // Calculate the target time for the next round to start
        const timeLimit = isPracticeMode ? parseInt(timeInput.value, 10) * 1000 : 4000; // Get the actual time limit for the round
        const targetNextRoundStartTime = roundStartTime + timeLimit;
        const delayUntilNextRound = Math.max(0, targetNextRoundStartTime - performance.now());

        if (isSuccess) {
            if (glowAnimationInterval) clearInterval(glowAnimationInterval);
            const glowElement = gameScreen.querySelector('.glow-indicator');
            if (glowElement) glowElement.classList.add('hidden');
            showToast('성공');
            const scrollContent = gameScreen.querySelector('.scroll-content');
                    if (scrollContent) scrollContent.style.display = 'none';
                    if (!isPracticeMode && !isMashPracticeMode) {                nextRoundTimeoutId = setTimeout(startNewRound, delayUntilNextRound);
            } else {
                // In practice mode, just restart the round after a short delay
                nextRoundTimeoutId = setTimeout(startNewRound, 1000); // Restart round after a short delay
            }
        } else { // Round failed (e.g., timeout)
            showToast('실패');
            if (!isPracticeMode && !isMashPracticeMode) {
                lifeLostInPreviousRound = true;
                nextRoundTimeoutId = setTimeout(startNewRound, delayUntilNextRound);
            } else {
                // In practice mode, just restart the round after a short delay
                nextRoundTimeoutId = setTimeout(startNewRound, 1000); // Restart round after a short delay
            }
        }
    };

    const handleCorrectInput = (isPlayer = false, commandId = -1) => {
        if (gameRecorder.isRecording() && !isReplaying) {
            const source = isPlayer ? 'p' : 'b';
            const id = isPlayer ? commandId : gamePattern[currentGameIndex];
            gameRecorder.add('I', id, source);
        }

        const iconToUpdate = document.querySelectorAll('.command-icon')[currentGameIndex];
        if (iconToUpdate) {
            iconToUpdate.src = iconToUpdate.src.replace('.png', '_off.png');
            iconToUpdate.classList.add('popping');
            iconToUpdate.addEventListener('animationend', () => {
                iconToUpdate.classList.remove('popping');
            }, { once: true });
        }
        currentGameIndex++;

        if (currentGameIndex % 6 === 0 && currentGameIndex < gamePattern.length) {
            const commandBox = document.querySelector('.command-box');
            const rowHeight = commandBox ? commandBox.offsetHeight : 65;
            const newTransformY = -((currentGameIndex / 6) * rowHeight);
            animateScroll(newTransformY);
        }
    };

    const processNextCommand = () => {
        if (gameFailed || isReplaying) return;

        if (currentGameIndex >= gamePattern.length) {
            if (isMashPracticeMode) {
                // Pattern complete, start 200ms timer to check for extra inputs.
                mashSuccessTimer = setTimeout(() => {
                    onRoundEnd(true); // Success if timer completes.
                }, 200);
            } else {
                onRoundEnd(true); // Normal success for other modes.
            }
            return;
        }

        updateGlowIndicator();

        const commandId = gamePattern[currentGameIndex];
        const isPigCommand = [1, 2, 3, 6].includes(commandId);
        const isPlayerTurn = (currentRole === '돼지' && isPigCommand) || (currentRole === '토끼' && !isPigCommand);

        if (!isPlayerTurn) {
            let delay = (botConfig.press_delays_ms && botConfig.press_delays_ms[commandId]) || 150;

            if (currentGameIndex === 0) {
                delay += botConfig.initial_reaction_delay_ms || 100;
            }
            
            botActionTimeout = setTimeout(() => {
                handleCorrectInput(false);
                processNextCommand();
            }, delay);
        }
    };

    const handlePlayerInput = (commandId) => {
        if (gameFailed || isReplaying) return;

        // Start timer on first press in mash mode
        if (isMashPracticeMode && currentGameIndex === 0) {
            if (commandId === gamePattern[0]) { // Only start on correct press
                const timeLimitInSeconds = gamePattern.length * 0.1; // 100ms per command
                roundStartTime = performance.now();

                if(roundTimer) clearTimeout(roundTimer);
                roundTimer = setTimeout(() => {
                    if (gameFailed) return;
                    onRoundEnd(false);
                }, timeLimitInSeconds * 1000);

                const gauge = gameScreen.querySelector('.timer-gauge');
                if (gauge) {
                    gauge.style.transition = 'none';
                    gauge.style.width = '100%';
                    gauge.offsetHeight; // Force reflow
                    gauge.style.transition = `width ${timeLimitInSeconds}s linear`;
                    gauge.style.width = '0%';
                }
            }
        }


        if (isMashPracticeMode && currentGameIndex >= gamePattern.length) {
            // Player has finished the pattern and is pressing extra keys.
            if (mashSuccessTimer) {
                clearTimeout(mashSuccessTimer);
                mashSuccessTimer = null;
            }
            onRoundEnd(false); // This is a failure.
            return;
        }

        const timeLimit = isPracticeMode ? parseInt(timeInput.value, 10) * 1000 : 4000;
        if (performance.now() - roundStartTime > timeLimit) {
            onRoundEnd(false);
            return;
        }

        const expectedCommand = gamePattern[currentGameIndex];

        if (commandId !== expectedCommand) {
            if (gameRecorder.isRecording()) {
                gameRecorder.add('X', commandId, 'p'); // Record the incorrect input
            }
            showMissAnimation();
            if (!isPracticeMode) {
                lifeLostInPreviousRound = true;
            }
            onRoundEnd(false);
            return;
        }

        const isPigCommand = [1, 2, 3, 6].includes(expectedCommand);
        const isPlayerTurn = (currentRole === '돼지' && isPigCommand) || (currentRole === '토끼' && !isPigCommand);

        if (isPlayerTurn) {
            if (botActionTimeout) clearTimeout(botActionTimeout);
            handleCorrectInput(true, commandId);
            processNextCommand();
        }
    };

    const animateScroll = (targetY) => {
        const scrollContent = gameScreen.querySelector('.scroll-content');
        if (!scrollContent) return;

        scrollContent.style.transition = 'none';

        const startY = parseFloat(scrollContent.style.transform.replace('translateY(', '')) || 0;
        const duration = 300; // ms
        let startTime = null;

        const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

        function animationStep(timestamp) {
            if (!startTime) startTime = timestamp;
            const progress = timestamp - startTime;
            const percentage = Math.min(progress / duration, 1);
            const easedPercentage = easeInOutCubic(percentage);

            const currentY = startY + (targetY - startY) * easedPercentage;
            scrollContent.style.transform = `translateY(${currentY}px)`;

            updateGlowIndicator();

            if (progress < duration) {
                requestAnimationFrame(animationStep);
            } else {
                scrollContent.style.transition = ''; // Re-enable for next time
            }
        }

        requestAnimationFrame(animationStep);
    };
    
    const renderFloorButtons = (role) => {
        const floorContainer = gameScreen.querySelector('.floor-container');
        if (!floorContainer) return;

        let buttons = (role === '돼지') ? [
            { cmd: 1, layout: 'pig-cmd1' }, { cmd: 2, layout: 'pig-cmd2' }, { cmd: 3, layout: 'pig-cmd3' },
            { cmd: 'item1', layout: 'pig-item1', item: true }, { cmd: 'item2', layout: 'pig-item2', item: true },
            { cmd: 6, layout: 'pig-cmd6' }
        ] : [
            { cmd: 8, layout: 'rabbit-cmd8' }, { cmd: 'item1', layout: 'rabbit-item1', item: true }, { cmd: 'item2', layout: 'rabbit-item2', item: true },
            { cmd: 4, layout: 'rabbit-cmd4' }, { cmd: 5, layout: 'rabbit-cmd5' }, { cmd: 7, layout: 'rabbit-cmd7' }
        ];

        const getButtonImagePath = (cmd, role, item) => {
            if (item) return 'res/thanksgiving_room_command_item.png';
            const prefix = (role === '돼지') ? 'thanksgiving2024' : 'thanksgiving';
            return `res/${prefix}_room_command${cmd}_unpressed.png`;
        };

        const buttonHTML = buttons.map(btn => `
            <div class="button-wrapper ${btn.layout}">
                <img src="${getButtonImagePath(btn.cmd, role, btn.item)}" 
                     class="floor-button ${btn.item ? 'item' : ''} ${btn.item ? '' : 'game-command'}" 
                     ${!btn.item ? `data-command="command${btn.cmd}"` : ''}>
                <div class="keybind-overlay ${btn.item ? 'hidden' : ''}" 
                     ${!btn.item ? `data-command-for-bind="command${btn.cmd}"` : ''}></div>
            </div>`).join('');

        floorContainer.innerHTML = `<img src="res/thanksgiving_room_container_top.png" class="floor-top"><div class="button-layout-container"><div class="button-cluster">${buttonHTML}</div></div>`;

        floorContainer.querySelectorAll('.game-command').forEach(setupButtonListeners);
        setupButtonListeners(gameScreen.querySelector('.exit-button'));
        floorContainer.querySelectorAll('.keybind-overlay:not(.hidden)').forEach(overlay => overlay.addEventListener('click', startKeyBinding));
        updateKeybindDisplays();
    };

    const showMainScreen = () => {
        if (glowAnimationInterval) clearInterval(glowAnimationInterval);
        if (missAnimationInterval) clearInterval(missAnimationInterval);
        if (roundTimer) clearTimeout(roundTimer);
        if (botActionTimeout) clearTimeout(botActionTimeout);
        if (nextRoundTimeoutId) clearTimeout(nextRoundTimeoutId);
        if (mashSuccessTimer) clearTimeout(mashSuccessTimer);
        if (nextReplayEventTimeout) clearTimeout(nextReplayEventTimeout);

        currentRound = 0;
        playerLives = 5; // Reset lives on returning to main screen
        lifeLostInPreviousRound = false; // Reset flag for next game
        isMashPracticeMode = false;
        isReplaying = false;

        mainContent.classList.remove('hidden');
        footerSettings.classList.remove('hidden');
        gameScreen.classList.add('hidden');
        rankingScreen.classList.add('hidden');
        if (rankingButtonContainer) rankingButtonContainer.classList.remove('hidden');
        gameScreen.innerHTML = '';
    };



    const adjustPatternDifficulty = (patternString, patternExtensionLevel) => {
        let segmentsToExtend = [];
        let tempPatternString = patternString;
        let match;
        const regex = /(Rp|tt)/g;

        // Find all extendable segments and their positions
        while ((match = regex.exec(tempPatternString)) !== null) {
            segmentsToExtend.push({ type: match[0], index: match.index });
        }

        if (segmentsToExtend.length === 0 || patternExtensionLevel <= 0) {
            return patternString; // No segments to extend or no extension allowed
        }

        // Calculate total extension budget
        const totalExtensionBudget = Math.floor(Math.random() * patternExtensionLevel);

        // --- New Distribution Logic ---
        let extensionCounts = new Array(segmentsToExtend.length).fill(0);
        let remainingBudget = totalExtensionBudget;

        // Calculate maximum allowed extension for a single segment
        // Constraint: no single extended part is more than 1:3 longer than the sum of all other extended parts.
        // This translates to: max 1/4 of total budget for any single segment.
        let maxExtensionPerSegment = totalExtensionBudget; // Default to no specific limit
        if (totalExtensionBudget >= 4) { // Apply constraint only if budget is large enough for it to be meaningful
            maxExtensionPerSegment = Math.floor(totalExtensionBudget / 4);
        }

        // Distribute budget iteratively, respecting the maxExtensionPerSegment constraint
        while (remainingBudget > 0) {
            let candidates = [];
            for (let k = 0; k < segmentsToExtend.length; k++) {
                if (extensionCounts[k] < maxExtensionPerSegment) {
                    candidates.push(k);
                }
            }

            if (candidates.length === 0) {
                // All segments have reached their individual max, but budget remains.
                // This means the constraint is too strict for the remaining budget or segments. 
                // Distribute remaining budget to any segment to ensure total budget is used.
                if (segmentsToExtend.length > 0) {
                    let randomIndex = Math.floor(Math.random() * segmentsToExtend.length);
                    extensionCounts[randomIndex]++;
                    remainingBudget--;
                } else {
                    break; // No segments to distribute to
                }
            } else {
                let randomIndex = candidates[Math.floor(Math.random() * candidates.length)];
                extensionCounts[randomIndex]++;
                remainingBudget--;
            }
        }
        // --- End New Distribution Logic ---

        // Reconstruct the pattern string with distributed extensions
        let adjustedPattern = "";
        let lastIndex = 0;
        let segmentIndex = 0;

        for (let i = 0; i < patternString.length; i++) {
            let isExtendedSegment = false;
            for (let j = 0; j < segmentsToExtend.length; j++) {
                if (segmentsToExtend[j].index === i) {
                    adjustedPattern += patternString.substring(lastIndex, i);
                    adjustedPattern += segmentsToExtend[j].type;
                    for (let k = 0; k < extensionCounts[segmentIndex]; k++) {
                        adjustedPattern += segmentsToExtend[j].type;
                    }
                    i += segmentsToExtend[j].type.length - 1; // Advance i by segment length - 1
                    lastIndex = i + 1;
                    segmentIndex++;
                    isExtendedSegment = true;
                    break;
                }
            }
            if (!isExtendedSegment && i >= lastIndex) {
                adjustedPattern += patternString[i];
                lastIndex = i + 1;
            }
        }
        adjustedPattern += patternString.substring(lastIndex);

        return adjustedPattern;
    };

    const transformRabbitPatterns = (patternString, rabbitTransformProbabilityFactor) => {
        let transformedPattern = "";
        let i = 0;
        while (i < patternString.length) {
            let processed = false;

            // 1. Prioritize checking for tttt
            if (patternString.substring(i, i + 4) === 'tttt') {
                if (Math.random() < rabbitTransformProbabilityFactor) {
                    transformedPattern += 'rr';
                } else {
                    transformedPattern += 'tttt';
                }
                i += 4;
                processed = true;
            }

            // 2. If tttt was not matched, check for tttttt
            if (!processed && patternString.substring(i, i + 6) === 'tttttt') {
                if (Math.random() < rabbitTransformProbabilityFactor) {
                    transformedPattern += 'rttr';
                } else {
                    transformedPattern += 'tttttt';
                }
                i += 6;
                processed = true;
            }

            // 3. If neither tttt nor tttttt was matched, handle single characters or tt pairs
            if (!processed) {
                if (patternString[i] === 't' && patternString[i+1] === 't') {
                    transformedPattern += 'tt'; // Keep the tt pair
                    i += 2;
                } else {
                    transformedPattern += patternString[i]; // Append single character
                    i++;
                }
            }
        }
        return transformedPattern;
    };

    const parsePatternString = (patternString) => {
        const pigNormalIcons = [1, 2, 3];
        const rabbitNormalIcons = [4, 5, 7];
        const pattern = [];
        for (const char of patternString) {
            switch (char) {
                case 'R':
                    pattern.push(pigNormalIcons[Math.floor(Math.random() * pigNormalIcons.length)]);
                    break;
                case 'r':
                    pattern.push(rabbitNormalIcons[Math.floor(Math.random() * rabbitNormalIcons.length)]);
                    break;
                case 'p':
                    pattern.push(6);
                    break;
                case 't':
                    pattern.push(8);
                    break;
                default:
                    // Ignore unknown characters
                    break;
            }
        }
        return pattern;
    };

    const showGameScreen = async (role, isReplay = false, replayTteokKey = null) => {
        let targetTteokKey = replayTteokKey;
        if (glowAnimationInterval) clearInterval(glowAnimationInterval);
        if (missAnimationInterval) clearInterval(missAnimationInterval);
        if (botActionTimeout) clearTimeout(botActionTimeout);
        if (mashSuccessTimer) clearTimeout(mashSuccessTimer);

        currentRole = role;
        rebuildRoleKeybinds(role);
        mainContent.classList.add('hidden');
        footerSettings.classList.add('hidden');
        rankingScreen.classList.add('hidden');
        if (rankingButtonContainer) rankingButtonContainer.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        
        let pattern; // This will be an array of row arrays

        if (isReplay) {
            // In replay mode, the pattern is already set in gamePattern
            pattern = [];
            for(let i = 0; i < gamePattern.length; i += 6) {
                pattern.push(gamePattern.slice(i, i + 6));
            }
        } else if (isMashPracticeMode) {
            const count = (Math.floor(Math.random() * 7) + 2) * 2; // Even number from 4 to 16
            const mashPattern = Array(count).fill(8);
            pattern = [];
            for(let i = 0; i < mashPattern.length; i += 6) {
                pattern.push(mashPattern.slice(i, i + 6));
            }
            targetTteokKey = 'Pig'; // Dummy value, not rendered
        } else if (isPracticeMode) {
            const lines = parseInt(linesInput.value, 10);
            pattern = patternGenerator.generateFullPattern(lines * 6, role);
            targetTteokKey = 'Pig'; // Assign default for practice mode
        } else {
            currentRound++; // Increment round counter
            try {
                // Determine available tteok for the current round
                let availableTteokForRound = [];
                for (const config of roundConfig.roundTteok) {
                    const [start, end] = config.rounds.split('-').map(s => parseInt(s, 10));
                    if (currentRound >= start && (isNaN(end) || currentRound <= end)) {
                        availableTteokForRound = config.availableTteok;
                        break;
                    }
                }

                if (availableTteokForRound.length === 0) {
                    throw new Error(`No tteok configured for round ${currentRound}`);
                }

                const tteokKeys = Object.keys(patternManifest).filter(key => availableTteokForRound.includes(key));
                if (tteokKeys.length === 0) {
                    throw new Error('patternManifest에 정의된 송편이 없습니다.');
                }
                const randomTteokKey = tteokKeys[Math.floor(Math.random() * tteokKeys.length)];
                
                const patternFiles = patternManifest[randomTteokKey];
                if (!patternFiles || patternFiles.length === 0) {
                    throw new Error(`${randomTteokKey}에 대한 패턴 파일이 patternManifest에 정의되어 있지 않습니다.`);
                }
                const randomPatternFile = patternFiles[Math.floor(Math.random() * patternFiles.length)];
                const patternFilePath = `patterns/${randomTteokKey}/${randomPatternFile}`;

                const response = await fetch(patternFilePath);
                if (!response.ok) throw new Error(`패턴 파일을 불러올 수 없습니다: ${patternFilePath} - ` + response.statusText);
                const patternString = await response.text();

                let currentPatternExtensionLevel = 1; // Default fallback
                let currentRabbitTransformProbabilityFactor = defaultRabbitTransformProbabilityFactor; // Use global default

                // Get default difficulty from progression
                for (const config of tteokDifficultyConfig.default_difficulty_progression) {
                    const [start, end] = config.rounds.split('-').map(s => parseInt(s, 10));
                    if (currentRound >= start && (isNaN(end) || currentRound <= end)) {
                        currentPatternExtensionLevel = config.pattern_extension_level;
                        break;
                    }
                }

                // Apply tteok-specific overrides if they exist
                const tteokConfig = tteokDifficultyConfig.tteok_difficulty[randomTteokKey];
                if (tteokConfig && tteokConfig.overrides) {
                    const tteokOverrides = tteokConfig.overrides;

                    if (typeof tteokOverrides.pattern_extension_level === 'number') {
                        currentPatternExtensionLevel = tteokOverrides.pattern_extension_level;
                    } else if (Array.isArray(tteokOverrides.pattern_extension_level)) {
                        for (const override of tteokOverrides.pattern_extension_level) {
                            const [start, end] = override.rounds.split('-').map(s => parseInt(s, 10));
                            if (currentRound >= start && (isNaN(end) || currentRound <= end)) {
                                currentPatternExtensionLevel = override.value;
                                break;
                            }
                        }
                    }

                    if (typeof tteokOverrides.rabbit_transform_probability_factor === 'number') { 
                        currentRabbitTransformProbabilityFactor = tteokOverrides.rabbit_transform_probability_factor;
                    } else if (Array.isArray(tteokOverrides.rabbit_transform_probability_factor)) {
                        for (const override of tteokOverrides.rabbit_transform_probability_factor) {
                            const [start, end] = override.rounds.split('-').map(s => parseInt(s, 10));
                            if (currentRound >= start && (isNaN(end) || currentRound <= end)) {
                                currentRabbitTransformProbabilityFactor = override.value;
                                break;
                            }
                        }
                    }
                }

                const adjustedPatternString = adjustPatternDifficulty(patternString.trim(), currentPatternExtensionLevel);
                const transformedPatternString = transformRabbitPatterns(adjustedPatternString, currentRabbitTransformProbabilityFactor);
                const parsedPattern = parsePatternString(transformedPatternString);
                
                pattern = [];
                for(let i = 0; i < parsedPattern.length; i += 6) {
                    pattern.push(parsedPattern.slice(i, i + 6));
                }
                targetTteokKey = randomTteokKey; // Set targetTteokKey here

            } catch (error) {
                console.error("패턴 로딩 실패:", error);
                alert("패턴 파일을 불러오는 데 실패했습니다. " + error.message);
                showMainScreen(); // Go back to main screen on error
                return;
            }
        }

        gamePattern = pattern.flat();
        
        currentGameIndex = 0;
        gameFailed = false;

        if (!isPracticeMode && !isMashPracticeMode && !isReplay) {
            if (currentRound === 1) {
                gameRecorder.start();
                gameRecorder.add('ROLE', role);
            }
            gameRecorder.add('R', currentRound);
            gameRecorder.add('T', targetTteokKey);
            gameRecorder.add('P', gamePattern.join(''));
        }

        const getIconPath=(id)=>{const s1=[1,2,3,6],s2=[4,5,7,8];if(s1.includes(id))return`res/thanksgiving2024_room_command${id}.png`;if(s2.includes(id))return`res/thanksgiving_room_command${id}.png`;return'';};
        const commandBoxesHTML = pattern.map(row => `
            <div class="command-box">
                ${row.map(id => `
                    <div class="command-icon-wrapper">
                        <img src="${getIconPath(id)}" class="command-icon">
                        <img class="miss-overlay hidden">
                    </div>
                `).join('')}
            </div>
        `).join('');
        
        const targetTteok = (assetMap.tteok && assetMap.tteok[targetTteokKey]) ? assetMap.tteok[targetTteokKey] : null;

        const recipeContainerHTML = (!isPracticeMode && !isMashPracticeMode && targetTteok) ? `
            <div class="recipe-container">
                <img src="res/thanksgiving_room_tteok_recipe_bg.png" class="recipe-bg">
                <img src="res/thanksgiving_room_tteok_recipe_box.9.png" class="recipe-box">
                <img src="${targetTteok.path}" class="recipe-tteok-image">
                <div class="recipe-tteok-name">${targetTteok.korean_name}</div>
            </div>
        ` : '';

        gameScreen.innerHTML = `
            <div class="ceiling">
                <div class="timer-container">
                    <img src="res/thanksgiving_room_time_bar.png" class="timer-bg">
                    <div class="timer-gauge-wrapper">
                        <div class="timer-gauge"></div>
                    </div>
                    <img src="res/thanksgiving_room_time_gauge.png" class="timer-overlay">
                    <img src="res/thanksgiving_room_time_icon.png" class="timer-icon">
                </div>
            </div>
            <img src="res/thanksgiving_room_exit_unpressed.png" class="exit-button">
            <div class="game-area">
                ${recipeContainerHTML}
                <img class="glow-indicator hidden">
                <div class="scroll-viewport"><div class="scroll-content">${commandBoxesHTML}</div></div>
            </div>
            <div class="floor-container"></div>`;
        
                const ceilingElement = gameScreen.querySelector('.ceiling');
        
                if (ceilingElement) {
        
                    if (isReplay) {
        
                        const roundDisplayElement = document.createElement('div');
        
                        roundDisplayElement.id = 'round-display';
        
                        roundDisplayElement.textContent = `Round ${currentRound}`;
        
                        ceilingElement.appendChild(roundDisplayElement);
        
        
        
                        // Add hearts for replay
        
                        const heartContainer = document.createElement('div');
        
                        heartContainer.id = 'heart-container';
        
                        const maxLives = 5;
        
                        for (let i = 0; i < maxLives; i++) {
        
                            const heart = document.createElement('img');
        
                            heart.className = 'heart-icon';
        
                            heartContainer.appendChild(heart);
        
                        }
        
                        ceilingElement.appendChild(heartContainer);
        
                        updateHeartDisplay(); // Update display based on replay lives
        
        
        
                    } else if (isMashPracticeMode) {
        
                        const roundDisplayElement = document.createElement('div');
        
                        roundDisplayElement.id = 'round-display';
        
                        roundDisplayElement.textContent = '연타 연습';
        
                        ceilingElement.appendChild(roundDisplayElement);
        
                    } else if (!isPracticeMode) {
        
                        const roundDisplayElement = document.createElement('div');
        
                        roundDisplayElement.id = 'round-display';
        
                        roundDisplayElement.textContent = `Round ${currentRound}`;
        
                        ceilingElement.appendChild(roundDisplayElement);
        
        
        
                        const heartContainer = document.createElement('div');
        
                        heartContainer.id = 'heart-container';
        
                        const maxLives = 5;
        
                        for (let i = 0; i < maxLives; i++) {
        
                            const heart = document.createElement('img');
        
                            heart.className = 'heart-icon';
        
                            heartContainer.appendChild(heart);
        
                        }
        
                        ceilingElement.appendChild(heartContainer);
        
                        updateHeartDisplay();
        
                    }
        
                }
        
        
        
                        const commandIcons = gameScreen.querySelectorAll('.command-icon');
        const imageLoadPromises = [];
        commandIcons.forEach(icon => {
            if (!icon.complete) {
                imageLoadPromises.push(new Promise(resolve => {
                    icon.onload = resolve;
                    icon.onerror = resolve; // Resolve on error too so one broken image doesn't stop the game
                }));
            }
        });

        await Promise.all(imageLoadPromises);

        renderFloorButtons(role);
        
        
        
                        if (isReplay) {
        
        
        
                            const floorContainer = gameScreen.querySelector('.floor-container');
        
        
        
                            if (floorContainer) {
        
        
        
                                // In replay mode, hide buttons but keep the container tray
        
        
        
                                floorContainer.querySelectorAll('.floor-button, .keybind-overlay').forEach(el => {
        
        
        
                                    el.style.visibility = 'hidden';
        
        
        
                                });
        
        
        
                            }
        
        
        
                        }
        
        
        
                        positionGlowReliably();

        if (!isMashPracticeMode) { // Run timer UI for normal games and replays
            const timeLimit = (isPracticeMode && !isReplay) ? parseInt(timeInput.value, 10) : 4;
            
            if (!isReplay) { // But only set the functional timeout for actual games
                if (roundTimer) clearTimeout(roundTimer);
                roundStartTime = performance.now();
                roundTimer = setTimeout(() => {
                    if (gameFailed) return;
                    onRoundEnd(false);
                }, timeLimit * 1000);
            }

            const gauge = gameScreen.querySelector('.timer-gauge');
            if (gauge) {
                gauge.style.transition = 'none';
                gauge.style.width = '100%';
                gauge.offsetHeight; 
                gauge.style.transition = `width ${timeLimit}s linear`;
                gauge.style.width = '0%';
            }
        }

        if (!isReplay) {
            processNextCommand();
        }
    };

    const validateAndStartGame = (role) => {
        if (isPracticeMode) {
            const lines = parseInt(linesInput.value,10), time = parseInt(timeInput.value,10);
            if(lines>=1000||time>=1000){alert("줄 또는 시간 값은 999를 초과할 수 없습니다.");return;}
            if(lines===0||time===0){alert("줄 또는 시간 값은 0이 될 수 없습니다.");return;}
            if(isNaN(lines)||isNaN(time)||lines<1||time<1){alert("유효하지 않은 값입니다. 1 이상의 숫자를 입력하세요.");return;}
        }
        showGameScreen(role);
    };

    // Function to allow starting from a specific round via console
    window.setCurrentRound = (roundNum) => {
        if (typeof roundNum === 'number' && roundNum >= 1) {
            currentRound = roundNum - 1; // Will be incremented to roundNum in showGameScreen
            console.log(`다음 라운드는 ${roundNum} 라운드부터 시작됩니다.`);
        } else {
            console.error("유효하지 않은 라운드 번호입니다. 1 이상의 숫자를 입력해주세요.");
        }
    };

    // =================================================================
    // SECTION 4: RANKING & REPLAY LOGIC
    // =================================================================

    const showRankingScreen = async (role = '돼지') => {
        mainContent.classList.add('hidden');
        footerSettings.classList.add('hidden');
        if (rankingButtonContainer) rankingButtonContainer.classList.add('hidden');
        rankingScreen.classList.remove('hidden');
        
        // Update active button style
        document.querySelectorAll('.role-selector-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.role === role);
        });

        const listElement = document.getElementById('ranking-list');
        listElement.innerHTML = '<div class="loading-text">랭킹 불러오는 중...</div>';

        try {
            const response = await fetch(`https://ranking-three-kappa.vercel.app/api/get-ranking?role=${role}`);
            if (!response.ok) {
                throw new Error(`서버 오류: ${response.status}`);
            }
            const rankings = await response.json();

            if (rankings.length === 0) {
                listElement.innerHTML = '<div class="loading-text">아직 랭킹이 없습니다.</div>';
                return;
            }

            listElement.innerHTML = rankings.map((r, index) => `
                <div class="ranking-item">
                    <span class="rank">${index + 1}위</span>
                    <span class="nickname">${r.nickname}</span>
                    <span class="round">${r.max_round} 라운드</span>
                    <button class="replay-button" data-replay='${r.data}'>리플레이</button>
                </div>
            `).join('');

            document.querySelectorAll('.replay-button').forEach(button => {
                button.addEventListener('click', (e) => {
                    const gameData = e.currentTarget.dataset.replay;
                    startReplay(gameData);
                });
            });

        } catch (error) {
            listElement.innerHTML = `<div class="loading-text">랭킹을 불러오지 못했습니다: ${error.message}</div>`;
            console.error('Failed to fetch rankings:', error);
        }
    };

    const startReplay = (gameData) => {
        isReplaying = true;
        playerLives = 5; // Reset lives for replay
        lifeLostInReplayRound = false; // Reset replay life loss flag
        rankingScreen.classList.add('hidden');

        const lines = gameData.split('\n');
        replayEvents = lines.map(line => {
            const parts = line.split(',');
            const type = parts[0];
            const value = parts[1];
            if (type === 'I' || type === 'X') {
                return { type, command: parseInt(value, 10), source: parts[2], time: parseInt(parts[3], 10) };
            }
            return { type, value };
        }).filter(e => e.type); // Filter out empty lines

        // Find and set the role for the entire replay
        const roleEvent = replayEvents.find(e => e.type === 'ROLE');
        currentRole = roleEvent ? roleEvent.value : '돼지'; // Default to 돼지 if not found

        replayLoop();
    };

    const replayLoop = () => {
        if (!isReplaying || replayEvents.length === 0) {
            showToast('리플레이 종료');
            gameScreen.classList.add('hidden');
            gameScreen.innerHTML = '';
            showRankingScreen(); // Go back to ranking screen when replay ends
            return;
        }

        const event = replayEvents.shift();
        let timeToNextEvent = 0;
        if (replayEvents.length > 0 && replayEvents[0].time && event.time) {
            timeToNextEvent = replayEvents[0].time - event.time;
        }

        switch (event.type) {
            case 'ROLE': // Role is handled in startReplay, just skip here
                replayLoop();
                break;

            case 'R':
                replayRoundStartTime = Date.now(); // Record when the round visually starts
                currentRound = parseInt(event.value, 10);

                // Handle life loss from the *previous* round
                if (lifeLostInReplayRound) {
                    playerLives--;
                    updateHeartDisplay();
                    lifeLostInReplayRound = false; // Reset for the new round
                }

                if (playerLives <= 0) {
                    showToast('리플레이 종료 - 게임 오버');
                    isReplaying = false;
                    showRankingScreen();
                    return;
                }

                const patternEvent = replayEvents.find(e => e.type === 'P');
                const tteokEvent = replayEvents.find(e => e.type === 'T');
                const tteokKey = tteokEvent ? tteokEvent.value : null;

                if (patternEvent) {
                    gamePattern = patternEvent.value.split('').map(Number);
                    showGameScreen(currentRole, true, tteokKey);
                }
                nextReplayEventTimeout = setTimeout(replayLoop, 500); // Wait a bit before starting inputs
                break;

            case 'P': // Pattern is handled by 'R', so we just skip it here
            case 'T': // Tteok is also handled by 'R'
                replayLoop();
                break;

            case 'I':
                handleCorrectInput();
                updateGlowIndicator();
                nextReplayEventTimeout = setTimeout(replayLoop, timeToNextEvent);
                break;

            case 'X':
            case 'O':
                if (event.type === 'X') {
                    showMissAnimation();
                }
                const outcome = event.value || 'fail';
                if (outcome === 'fail') {
                    lifeLostInReplayRound = true;
                }
                showToast(outcome === 'success' ? '성공' : '실패');

                const timeElapsed = Date.now() - replayRoundStartTime;
                const delayForNextRound = Math.max(0, 4000 - timeElapsed);

                nextReplayEventTimeout = setTimeout(() => {
                    // Fast-forward to the next 'R' or end of events
                    while(replayEvents.length > 0 && !['R', 'T', 'P'].includes(replayEvents[0].type)) {
                        replayEvents.shift();
                    }
                    // Now remove the T and P events as they are handled by R
                    while(replayEvents.length > 0 && (replayEvents[0].type === 'T' || replayEvents[0].type === 'P')) {
                        replayEvents.shift();
                    }
                    replayLoop();
                }, delayForNextRound);
                break;

            default:
                replayLoop(); // Move to next event if unknown
                break;
        }
    };

    // =================================================================
    // SECTION 4: EVENT HANDLERS & LISTENERS
    // =================================================================

    function handlePress(event) {
        const target = event.currentTarget;
        target.classList.add('pressed');
        if (target.classList.contains('floor-button') && target.src.includes('_unpressed.png')) {
            target.src = target.src.replace('_unpressed.png', '_pressed.png');
        }
    }

    function handleRelease(event) {
        const target = event.currentTarget;
        target.classList.remove('pressed');
        if (target.classList.contains('floor-button') && target.src.includes('_pressed.png')) {
            target.src = target.src.replace('_pressed.png', '_unpressed.png');
        }
    }

    function handleActivation(event) {
        const target = event.currentTarget;
        if (target.classList.contains('exit-button')) {
            if (isReplaying) {
                isReplaying = false;
                if(nextReplayEventTimeout) clearTimeout(nextReplayEventTimeout);
                gameScreen.classList.add('hidden');
                gameScreen.innerHTML = '';
                showRankingScreen();
            } else {
                showMainScreen();
            }
        } else if (target.hasAttribute('data-command')) {
            const commandId = parseInt(target.dataset.command.replace('command', ''), 10);
            handlePlayerInput(commandId);
        } else if (target.classList.contains('choice-button')) {
            if (target.id === 'ranking-button') {
                showRankingScreen();
            } else {
                validateAndStartGame(target.textContent);
            }
        }
    }

    function setupButtonListeners(button) {
        button.addEventListener('mousedown', handlePress);
        button.addEventListener('mouseup', (e) => {
            handleRelease(e);
            handleActivation(e);
        });
        button.addEventListener('mouseleave', handleRelease);
        
        button.addEventListener('touchstart', handlePress, { passive: true });
        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleRelease(e);
            handleActivation(e);
        });
        button.addEventListener('touchcancel', handleRelease);
    }

    document.addEventListener('keydown', (event) => {
        if (event.repeat || isReplaying) return;

        if (isBindingKey) {
            event.preventDefault();
            const key = event.key.toLowerCase();
            
            if (!commandBinds[currentRole]) commandBinds[currentRole] = {};
            const roleBinds = commandBinds[currentRole];

            for (const cmd in roleBinds) {
                if (roleBinds[cmd] === key) {
                    delete roleBinds[cmd];
                    break;
                }
            }

            delete roleBinds[commandToBind];
            roleBinds[commandToBind] = key;

            saveKeybinds();
            rebuildRoleKeybinds(currentRole);
            updateKeybindDisplays();
            isBindingKey = false;
            commandToBind = null;

        } else if (!gameScreen.classList.contains('hidden')) {
            const command = keybinds[event.key.toLowerCase()];
            if (command) {
                event.preventDefault();
                const buttonImg = gameScreen.querySelector(`[data-command="${command}"]`);
                if (buttonImg) {
                    handlePress({ currentTarget: buttonImg });
                }
            }
        }
    });

    document.addEventListener('keyup', (event) => {
        if (isReplaying) return;
        if (!isBindingKey && !gameScreen.classList.contains('hidden')) {
            const command = keybinds[event.key.toLowerCase()];
            if (command) {
                event.preventDefault();
                const buttonImg = gameScreen.querySelector(`[data-command="${command}"]`);
                if (buttonImg) {
                    handleRelease({ currentTarget: buttonImg });
                    handleActivation({ currentTarget: buttonImg });
                }
            }
        }
    });

    const startMashPracticeMode = () => {
        isMashPracticeMode = true;
        showGameScreen('토끼');
    };

    choiceButtons.forEach(button => {
        // This loop now correctly handles the ranking button as well
        if (button.id === 'ranking-button') {
            setupButtonListeners(button);
        } else if (button.textContent === '토끼') {
            const startPress = (e) => {
                handlePress({ currentTarget: button });
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    startMashPracticeMode();
                }, 750);
            };

            const endPress = (e) => {
                handleRelease({ currentTarget: button });
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                    handleActivation({ currentTarget: button });
                }
            };
            
            const cancelPress = (e) => {
                handleRelease({ currentTarget: button });
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            };

            button.addEventListener('mousedown', startPress);
            button.addEventListener('mouseup', endPress);
            button.addEventListener('mouseleave', cancelPress);
            
            button.addEventListener('touchstart', (e) => { e.preventDefault(); startPress(e); }, { passive: false });
            button.addEventListener('touchend', (e) => { e.preventDefault(); endPress(e); });
            button.addEventListener('touchcancel', cancelPress);

        } else {
            setupButtonListeners(button);
        }
    });

    backToMainButton.addEventListener('click', showMainScreen);

    document.querySelectorAll('.role-selector-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const role = e.currentTarget.dataset.role;
            showRankingScreen(role);
        });
    });

    practiceToggle.addEventListener('click', () => {
        isPracticeMode = !isPracticeMode;
        localStorage.setItem('isPracticeMode', isPracticeMode);
        practiceToggle.textContent = `연습모드: ${isPracticeMode ? '켬' : '끔'}`;
        if (isPracticeMode) {
            practiceSettings.classList.remove('hidden');
            nicknameSettings.classList.add('hidden');
        } else {
            practiceSettings.classList.add('hidden');
            nicknameSettings.classList.remove('hidden');
        }
    });

    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => { alert(`전체화면 모드를 시작할 수 없습니다: ${err.message}`); });
        } else {
            if (document.exitFullscreen) { document.exitFullscreen(); }
        }
    }
    fullscreenToggle.addEventListener('click', toggleFullScreen);

    nicknameInput.addEventListener('input', () => {
        localStorage.setItem('nickname', nicknameInput.value);
    });

    const setupInputValidation = (input, lastValidValueRef, storageKey) => {
        input.addEventListener('focus', () => { lastValidValueRef.value = input.value; });
        input.addEventListener('input', () => { let v=input.value; if(v==='0')input.value=''; else if(v.length>3)input.value=v.slice(0,3); });
        input.addEventListener('blur', () => { if(input.value==='')input.value=lastValidValueRef.value; localStorage.setItem(storageKey,input.value); });
    };

    if (linesInput && timeInput) {
        setupInputValidation(linesInput, { get:()=>lastValidLines, set:(v)=>lastValidLines=v }, 'practiceLines');
        setupInputValidation(timeInput, { get:()=>lastValidTime, set:(v)=>lastValidTime=v }, 'practiceTime');
    }

    // =================================================================
    // SECTION 5: APP INITIALIZATION
    // =================================================================

    const initializeApp = async () => {
        loadKeybinds();
        try {
            const botConfigResponse = await fetch('bot_config.json');
            if (!botConfigResponse.ok) throw new Error('Bot config fetch failed');
            botConfig = await botConfigResponse.json();
        } catch (error) {
            console.error("bot_config.json 로딩 실패:", error);
            alert("봇 설정을 불러오는 데 실패했습니다.");
        }

        try {
            const assetMapResponse = await fetch('asset_map.json');
            if (!assetMapResponse.ok) throw new Error('Asset map fetch failed');
            assetMap = await assetMapResponse.json();
        } catch (error) {
            console.error("asset_map.json 로딩 실패:", error);
            alert("이미지 정보를 불러오는 데 실패했습니다.");
        }

        try {
            const patternManifestResponse = await fetch('pattern_manifest.json');
            if (!patternManifestResponse.ok) throw new Error('Pattern manifest fetch failed');
            patternManifest = await patternManifestResponse.json();

            const tteokDifficultyConfigResponse = await fetch('tteok_difficulty_config.json');
            if (!tteokDifficultyConfigResponse.ok) throw new Error('Tteok difficulty config fetch failed');
            tteokDifficultyConfig = await tteokDifficultyConfigResponse.json();
            defaultRabbitTransformProbabilityFactor = tteokDifficultyConfig.default_rabbit_transform_probability_factor || 0.7;

            const roundConfigResponse = await fetch('round_config.json');
            if (!roundConfigResponse.ok) throw new Error('Round config fetch failed');
            roundConfig = await roundConfigResponse.json();


        } catch (error) {
            console.error("pattern_manifest.json 로딩 실패:", error);
            alert("패턴 매니페스트를 불러오는 데 실패했습니다.");
        }

        const staticImages = [
            'res/roomskin_none_background.png',
            'res/thanksgiving_room_command_item.png',
            'res/thanksgiving_room_container_top.png',
            'res/thanksgiving_room_container.9.png',
            'res/thanksgiving_room_exit_unpressed.png',
            'res/thanksgiving_room_header_command_box.png',
            'res/thanksgiving_room_time_bar.png',
            'res/thanksgiving_room_time_gauge.png',
            'res/thanksgiving_room_time_icon.png',
            'res/thanksgiving_room_tteok_recipe_bg.png',
            'res/thanksgiving_room_tteok_recipe_box.9.png',
            'res/thanksgiving_room_heart.png',
            'res/thanksgiving_room_heart_off.png',
            // Pig Commands
            'res/thanksgiving2024_room_command1.png', 'res/thanksgiving2024_room_command1_off.png', 'res/thanksgiving2024_room_command1_pressed.png', 'res/thanksgiving2024_room_command1_unpressed.png',
            'res/thanksgiving2024_room_command2.png', 'res/thanksgiving2024_room_command2_off.png', 'res/thanksgiving2024_room_command2_pressed.png', 'res/thanksgiving2024_room_command2_unpressed.png',
            'res/thanksgiving2024_room_command3.png', 'res/thanksgiving2024_room_command3_off.png', 'res/thanksgiving2024_room_command3_pressed.png', 'res/thanksgiving2024_room_command3_unpressed.png',
            'res/thanksgiving2024_room_command6.png', 'res/thanksgiving2024_room_command6_off.png', 'res/thanksgiving2024_room_command6_pressed.png', 'res/thanksgiving2024_room_command6_unpressed.png',
            // Rabbit Commands
            'res/thanksgiving_room_command4.png', 'res/thanksgiving_room_command4_off.png', 'res/thanksgiving_room_command4_pressed.png', 'res/thanksgiving_room_command4_unpressed.png',
            'res/thanksgiving_room_command5.png', 'res/thanksgiving_room_command5_off.png', 'res/thanksgiving_room_command5_pressed.png', 'res/thanksgiving_room_command5_unpressed.png',
            'res/thanksgiving_room_command7.png', 'res/thanksgiving_room_command7_off.png', 'res/thanksgiving_room_command7_pressed.png', 'res/thanksgiving_room_command7_unpressed.png',
            'res/thanksgiving_room_command8.png', 'res/thanksgiving_room_command8_off.png', 'res/thanksgiving_room_command8_pressed.png', 'res/thanksgiving_room_command8_unpressed.png',
        ];

        const dynamicTteokImages = assetMap.tteok ? Object.values(assetMap.tteok).map(tteok => tteok.path) : [];

        const allImagesToPreload = [
            ...staticImages,
            ...dynamicTteokImages,
            ...pigGlowFrames,
            ...rabbitGlowFrames,
            ...pigMissFrames,
            ...rabbitMissFrames
        ];

        try {
            await preloadImages(allImagesToPreload);
        } catch (error) {
            console.error("이미지 로딩 실패:", error);
        }
        loadingOverlay.classList.add('hidden');

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            fullscreenToggle.style.visibility = 'hidden';
        }

        const savedPracticeMode = localStorage.getItem('isPracticeMode');
        isPracticeMode = savedPracticeMode === null ? true : (savedPracticeMode === 'true');
        practiceToggle.textContent = `연습모드: ${isPracticeMode ? '켬' : '끔'}`;
        if (isPracticeMode) {
            practiceSettings.classList.remove('hidden');
            nicknameSettings.classList.add('hidden');
        } else {
            practiceSettings.classList.add('hidden');
            nicknameSettings.classList.remove('hidden');
        }

        const savedLines = localStorage.getItem('practiceLines') || '5';
        const savedTime = localStorage.getItem('practiceTime') || '4';
        linesInput.value = savedLines;
        timeInput.value = savedTime;
        lastValidLines = savedLines;
        lastValidTime = savedTime;

        const savedNickname = localStorage.getItem('nickname') || '';
        nicknameInput.value = savedNickname;
    };

    initializeApp();
});
