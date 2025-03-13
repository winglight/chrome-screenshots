console.log('Background script loaded');  // 用于调试

let intervalTasks = {};

// 处理扩展按钮点击
chrome.action.onClicked.addListener((tab) => {
    console.log('Extension icon clicked for tab:', tab.id);
    
    // 确保标签页 ID 有效
    if (!tab || !tab.id) {
        console.error('无效的标签页 ID');
        return;
    }
    
    // 检查标签页 URL 是否受限
    if (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('devtools://') || 
        tab.url.startsWith('chrome-extension://')) {
        console.error('无法在浏览器内部页面上使用此扩展');
        // 可以考虑显示一个通知
        return;
    }
    
    // 发送消息到内容脚本
    chrome.tabs.sendMessage(tab.id, { type: 'toggleSidebar' })
        .then(response => {
            console.log('toggleSidebar 消息发送成功:', response);
        })
        .catch(error => {
            console.error('Error sending toggleSidebar message:', error);
            
            // 如果消息发送失败，可能是内容脚本尚未加载
            // 尝试注入内容脚本
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            }).then(() => {
                // 脚本注入后再次尝试发送消息
                setTimeout(() => {
                    chrome.tabs.sendMessage(tab.id, { type: 'toggleSidebar' })
                        .catch(err => console.error('Second attempt failed:', err));
                }, 200);
            }).catch(err => {
                console.error('Failed to inject content script:', err);
            });
        });
});

// 处理任务消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request.type);
    
    if (request.type === 'startTask') {
        const task = request.task;
        const tabId = sender.tab ? sender.tab.id : null;
        
        if (tabId) {
            executeTask(task, tabId);
            intervalTasks[task.id] = setInterval(() => {
                executeTask(task, tabId);
            }, task.interval);
            sendResponse({success: true});
        } else {
            console.error('No tab ID found for task:', task);
            sendResponse({success: false, error: 'No tab ID found'});
        }
        return true;
    }
    
    if (request.type === 'stopTask') {
        if (intervalTasks[request.taskId]) {
            clearInterval(intervalTasks[request.taskId]);
            delete intervalTasks[request.taskId];
            sendResponse({success: true});
        } else {
            sendResponse({success: false, error: 'Task not found'});
        }
        return true;
    }

    if (request.type === 'captureScreenshot') {
        try {
            chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    console.error('Screenshot capture error:', chrome.runtime.lastError);
                    sendResponse({error: chrome.runtime.lastError.message});
                    return;
                }
                
                // 将 dataUrl 转换为 blob
                fetch(dataUrl)
                    .then(res => res.blob())
                    .then(blob => {
                        // 使用 createImageBitmap 代替 Image
                        createImageBitmap(blob)
                            .then(imageBitmap => {
                                try {
                                    // 创建 OffscreenCanvas 来裁剪图像
                                    const canvas = new OffscreenCanvas(request.data.width, request.data.height);
                                    const ctx = canvas.getContext('2d');
                                    
                                    ctx.drawImage(imageBitmap,
                                        request.data.x, request.data.y,
                                        request.data.width, request.data.height,
                                        0, 0,
                                        request.data.width, request.data.height
                                    );
                                    
                                    // 将 canvas 转换为 blob
                                    canvas.convertToBlob({type: 'image/png'})
                                        .then(croppedBlob => {
                                            // 使用 FileReader 将 blob 转换为 ArrayBuffer
                                            const reader = new FileReader();
                                            reader.onloadend = function() {
                                                const arrayBuffer = reader.result;
                                                sendResponse({
                                                    type: 'image/png',
                                                    data: Array.from(new Uint8Array(arrayBuffer))
                                                });
                                            };
                                            reader.onerror = function() {
                                                console.error('Error reading blob data');
                                                sendResponse({error: '读取截图数据失败'});
                                            };
                                            reader.readAsArrayBuffer(croppedBlob);
                                        })
                                        .catch(error => {
                                            console.error('Error converting canvas to blob:', error);
                                            sendResponse({error: error.message});
                                        });
                                } catch (error) {
                                    console.error('Error processing screenshot:', error);
                                    sendResponse({error: error.message});
                                }
                            })
                            .catch(error => {
                                console.error('Error creating image bitmap:', error);
                                sendResponse({error: error.message});
                            });
                    })
                    .catch(error => {
                        console.error('Error fetching data URL:', error);
                        sendResponse({error: error.message});
                    });
        });
    } catch (error) {
        console.error('Error in captureVisibleTab:', error);
        sendResponse({error: error.message});
    }
    return true;
}
    
    // 在 chrome.runtime.onMessage.addListener 中添加新的消息处理
    if (request.type === 'sendScreenshot') {
        console.log('收到截图发送请求');
        
        // 从 Base64 转回 Blob
        fetch(request.screenshot)
            .then(res => res.blob())
            .then(blob => {
                // 创建 FormData 对象
                const formData = new FormData();
                formData.append('screenshot', blob, 'screenshot.png');
                
                // 发送到服务器
                return fetch(request.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${request.apiToken}`
                    },
                    body: formData
                });
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`服务器响应错误: ${response.status} ${response.statusText}`);
                }
                return response.json().catch(() => ({})); // 尝试解析 JSON，如果失败则返回空对象
            })
            .then(data => {
                console.log('截图发送成功:', data);
                sendResponse({ success: true, data });
            })
            .catch(error => {
                console.error('截图发送失败:', error);
                sendResponse({ success: false, error: error.message });
            });
        
        return true; // 表示将异步发送响应
    }
    return true;
});

async function executeTask(task, tabId) {
    try {
        console.log(`Executing task ${task.id} for tab ${tabId}`);
        chrome.tabs.sendMessage(tabId, {
            type: 'executeTask',
            task: task
        }).catch(error => {
            console.error(`Task ${task.id} execution failed:`, error);
        });
    } catch (error) {
        console.error(`Task ${task.id} execution failed:`, error);
    }
}