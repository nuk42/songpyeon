document.addEventListener('DOMContentLoaded', () => {

    // --- Constants & State ---
    const practiceToggle = document.getElementById('practice-toggle');
    const fullscreenToggle = document.getElementById('fullscreen-toggle');
    const practiceSettings = document.getElementById('practice-settings');
    const linesInput = document.getElementById('lines-input');
    const timeInput = document.getElementById('time-input');
    const choiceButtons = document.querySelectorAll('.choice-button');
    const mainContent = document.querySelector('.main-content');
    const footerSettings = document.querySelector('.footer-settings');
    const gameScreen = document.getElementById('game-screen');
    const loadingOverlay = document.getElementById('loading-overlay');

    let isPracticeMode = true;
    let lastValidLines, lastValidTime;
    let gamePattern = [];
    let currentGameIndex = 0;
    let gameFailed = false;
    let currentRole = null;
    let roundTimer = null;
    let roundStartTime = 0;
    let glowAnimationInterval = null;
    let missAnimationInterval = null;
    let scrollAnimationId = null;
    let nextRoundTimeoutId = null;
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

    const startNewRound = () => {
        if (roundTimer) clearTimeout(roundTimer);
        showGameScreen(currentRole);
    };


    const onRoundEnd = (isSuccess) => {
        if (roundTimer) clearTimeout(roundTimer);
        if (botActionTimeout) clearTimeout(botActionTimeout);
        gameFailed = true;

        if (isSuccess) {
            if (glowAnimationInterval) clearInterval(glowAnimationInterval);
            const glowElement = gameScreen.querySelector('.glow-indicator');
            if (glowElement) glowElement.classList.add('hidden');
            showToast('성공');
            const scrollContent = gameScreen.querySelector('.scroll-content');
            if (scrollContent) scrollContent.style.display = 'none';
        } else {
            showToast('실패');
        }

        nextRoundTimeoutId = setTimeout(startNewRound, 1000);
    };

    const handleCorrectInput = () => {
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
        if (gameFailed) return;

        if (currentGameIndex >= gamePattern.length) {
            onRoundEnd(true);
            return;
        }

        updateGlowIndicator();

        const commandId = gamePattern[currentGameIndex];
        const isPigCommand = [1, 2, 3, 6].includes(commandId);
        const isPlayerTurn = (currentRole === '돼지' && isPigCommand) || (currentRole === '토끼' && !isPigCommand);

        if (!isPlayerTurn) {
            const delay = (botConfig.press_delays_ms && botConfig.press_delays_ms[commandId]) || 150;
            botActionTimeout = setTimeout(() => {
                handleCorrectInput();
                processNextCommand();
            }, delay);
        }
    };

    const handlePlayerInput = (commandId) => {
        if (gameFailed) return;

        const timeLimit = isPracticeMode ? parseInt(timeInput.value, 10) * 1000 : 4000;
        if (performance.now() - roundStartTime > timeLimit) {
            onRoundEnd(false);
            return;
        }

        const expectedCommand = gamePattern[currentGameIndex];

        if (commandId !== expectedCommand) {
            showMissAnimation();
            onRoundEnd(false);
            return;
        }

        const isPigCommand = [1, 2, 3, 6].includes(expectedCommand);
        const isPlayerTurn = (currentRole === '돼지' && isPigCommand) || (currentRole === '토끼' && !isPigCommand);

        if (isPlayerTurn) {
            if (botActionTimeout) clearTimeout(botActionTimeout);
            handleCorrectInput();
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
        mainContent.classList.remove('hidden');
        footerSettings.classList.remove('hidden');
        gameScreen.classList.add('hidden');
        gameScreen.innerHTML = '';
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

    const showGameScreen = async (role) => {
        if (glowAnimationInterval) clearInterval(glowAnimationInterval);
        if (missAnimationInterval) clearInterval(missAnimationInterval);
        if (botActionTimeout) clearTimeout(botActionTimeout);
        currentRole = role;
        rebuildRoleKeybinds(role);
        mainContent.classList.add('hidden');
        footerSettings.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        
        let pattern; // This will be an array of row arrays
        if (isPracticeMode) {
            const lines = parseInt(linesInput.value, 10);
            pattern = patternGenerator.generateFullPattern(lines * 6, role);
        } else {
            try {
                const response = await fetch(`patterns/Pig.txt`);
                if (!response.ok) throw new Error('패턴 파일을 불러올 수 없습니다: ' + response.statusText);
                const patternString = await response.text();
                const parsedPattern = parsePatternString(patternString.trim());
                
                pattern = [];
                for(let i = 0; i < parsedPattern.length; i += 6) {
                    pattern.push(parsedPattern.slice(i, i + 6));
                }
            } catch (error) {
                console.error("패턴 로딩 실패:", error);
                alert("패턴 파일(patterns/Pig.txt)을 불러오는 데 실패했습니다.");
                showMainScreen(); // Go back to main screen on error
                return;
            }
        }

        gamePattern = pattern.flat();
        currentGameIndex = 0;
        gameFailed = false;

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
        
        const targetTteokKey = 'Pig';
        const targetTteok = (assetMap.tteok && assetMap.tteok[targetTteokKey]) ? assetMap.tteok[targetTteokKey] : null;

        const recipeContainerHTML = !isPracticeMode && targetTteok ? `
            <div class="recipe-container">
                <img src="res/thanksgiving_room_tteok_recipe_bg.png" class="recipe-bg">
                <img src="${targetTteok.path}" class="recipe-tteok-image">
                <img src="res/thanksgiving_room_tteok_recipe_box.9.png" class="recipe-box">
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
        
        renderFloorButtons(role);
        positionGlowReliably();

        if (roundTimer) clearTimeout(roundTimer);
        const timeLimit = isPracticeMode ? parseInt(timeInput.value, 10) : 4;
        roundStartTime = performance.now();
        roundTimer = setTimeout(() => {
            if (gameFailed) return;
            onRoundEnd(false);
        }, timeLimit * 1000);

        const gauge = gameScreen.querySelector('.timer-gauge');
        if (gauge) {
            gauge.style.transition = 'none';
            gauge.style.width = '100%';
            gauge.offsetHeight; 
            gauge.style.transition = `width ${timeLimit}s linear`;
            gauge.style.width = '0%';
        }

        processNextCommand();
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
            showMainScreen();
        } else if (target.hasAttribute('data-command')) {
            const commandId = parseInt(target.dataset.command.replace('command', ''), 10);
            handlePlayerInput(commandId);
        } else if (target.classList.contains('choice-button')) {
            validateAndStartGame(target.textContent);
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
        if (event.repeat) return;

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

    choiceButtons.forEach(setupButtonListeners);

        practiceToggle.addEventListener('click', () => {
        isPracticeMode = !isPracticeMode;
        localStorage.setItem('isPracticeMode', isPracticeMode);
        practiceToggle.textContent = `연습모드: ${isPracticeMode ? '켬' : '끔'}`;
        practiceSettings.classList.toggle('hidden');
    });

    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => { alert(`전체화면 모드를 시작할 수 없습니다: ${err.message}`); });
        } else {
            if (document.exitFullscreen) { document.exitFullscreen(); }
        }
    }
    fullscreenToggle.addEventListener('click', toggleFullScreen);

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

    const imagesToPreload = [
        'res/roomskin_none_background.png',
        'res/thanksgiving_room_command_item.png',
        'res/thanksgiving_room_container_top.png',
        'res/thanksgiving_room_container.9.png',
        'res/thanksgiving_room_exit_unpressed.png',
        'res/thanksgiving_room_header_command_box.png',
        'res/thanksgiving_room_time_bar.png',
        'res/thanksgiving_room_time_gauge.png',
        'res/thanksgiving_room_time_icon.png',
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
        ...pigGlowFrames,
        ...rabbitGlowFrames,
        ...pigMissFrames,
        ...rabbitMissFrames
    ];

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
            await preloadImages(imagesToPreload);
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
        } else {
            practiceSettings.classList.add('hidden');
        }

        const savedLines = localStorage.getItem('practiceLines') || '5';
        const savedTime = localStorage.getItem('practiceTime') || '4';
        linesInput.value = savedLines;
        timeInput.value = savedTime;
        lastValidLines = savedLines;
        lastValidTime = savedTime;
    };

    initializeApp();
});