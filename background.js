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
            console.log(`Starting task ${task.id} with interval ${task.interval}ms`);
            
            // 立即执行一次任务
            executeTask(task, tabId);
            
            // 清除可能存在的旧定时器
            if (intervalTasks[task.id]) {
                clearInterval(intervalTasks[task.id]);
                delete intervalTasks[task.id];
            }
            
            // 清除可能存在的旧 alarm
            chrome.alarms.clear(`task_${task.id}`);
            
            // 创建新的 alarm 代替 setInterval
            chrome.alarms.create(`task_${task.id}`, {
                periodInMinutes: task.interval / (60 * 1000),
                delayInMinutes: task.interval / (60 * 1000)
            });
            
            // 保存任务状态到存储
            chrome.storage.local.get(['activeTasks'], (result) => {
                const activeTasks = result.activeTasks || {};
                activeTasks[task.id] = {
                    tabId: tabId,
                    lastRun: Date.now()
                };
                chrome.storage.local.set({ activeTasks });
            });
            
            sendResponse({success: true});
        } else {
            console.error('No tab ID found for task:', task);
            sendResponse({success: false, error: 'No tab ID found'});
        }
        return true;
    }
    
    if (request.type === 'stopTask') {
        console.log(`Stopping task ${request.taskId}`);
        
        // 清除 alarm
        chrome.alarms.clear(`task_${request.taskId}`);
        
        // 清除可能存在的 setInterval
        if (intervalTasks[request.taskId]) {
            clearInterval(intervalTasks[request.taskId]);
            delete intervalTasks[request.taskId];
        }
        
        // 从存储中移除活动任务
        chrome.storage.local.get(['activeTasks'], (result) => {
            const activeTasks = result.activeTasks || {};
            delete activeTasks[request.taskId];
            chrome.storage.local.set({ activeTasks });
        });
        
        sendResponse({success: true});
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
    if (request && request.type === 'listChatGPTTabs') {
      try {
        chrome.tabs.query({ url: ['https://chat.openai.com/*', 'https://chatgpt.com/*'] }, (tabs) => {
          const list = (tabs || []).map(t => ({ id: t.id, title: t.title, active: t.active, windowId: t.windowId, url: t.url }));
          sendResponse({ success: true, tabs: list });
        });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }
    if (request && request.type === 'sendToChatGPT') {
      const isChatUrl = (url) => /https?:\/\/(chat\.openai\.com|chatgpt\.com)\//i.test(url || '');
      const pickFallbackTab = (cb) => {
        chrome.tabs.query({ url: ['https://chat.openai.com/*', 'https://chatgpt.com/*'] }, (tabs) => {
          if (tabs && tabs.length) {
            const activeTab = tabs.find(t => t.active) || tabs[0];
            cb(activeTab);
          } else {
            cb(null);
          }
        });
      };
  
      const proceed = (targetTab) => {
        if (!targetTab) {
          sendResponse({ success: false, error: '未找到 ChatGPT 标签页' });
          return;
        }
        const tabId = targetTab.id;

        const payload = {
          type: 'composeInChatGPT',
          imageDataUrl: request.imageDataUrl || null,
          text: request.text || ''
        };

        const sendCompose = () => {
          try {
            chrome.tabs.sendMessage(tabId, payload, (resp) => {
              if (chrome.runtime.lastError) {
                console.warn('sendMessage 失败，尝试注入内容脚本后重试：', chrome.runtime.lastError.message);
                // 注入内容脚本并重试
                chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
                  if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                  }
                  setTimeout(() => {
                    try {
                      chrome.tabs.sendMessage(tabId, payload, (resp2) => {
                        if (chrome.runtime.lastError) {
                          sendResponse({ success: false, error: chrome.runtime.lastError.message });
                          return;
                        }
                        sendResponse(resp2 || { success: true });
                      });
                    } catch (e) {
                      sendResponse({ success: false, error: e.message });
                    }
                  }, 250);
                });
              } else {
                sendResponse(resp || { success: true });
              }
            });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        };

        // 激活并发送（适当延时，确保页面与内容脚本可用）
        chrome.tabs.update(tabId, { active: true }, () => {
          setTimeout(sendCompose, 600);
        });
      };
  
      try {
        if (request.targetTabId) {
          chrome.tabs.get(Number(request.targetTabId), (tab) => {
            if (chrome.runtime.lastError || !tab) {
              pickFallbackTab(proceed);
            } else {
              proceed(tab);
            }
          });
        } else {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const active = (tabs && tabs[0]) || null;
            if (active && isChatUrl(active.url)) {
              proceed(active);
            } else {
              pickFallbackTab(proceed);
            }
          });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true; // async
    }
    return true;
});

async function executeTask(task, tabId) {
    try {
        console.log(`Executing task ${task.id} for tab ${tabId}`);
        
        // 首先激活目标标签页，确保截图在正确的标签页上进行
        try {
            await chrome.tabs.update(tabId, { active: true });
            // 给页面一点时间加载和渲染
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`无法激活标签页 ${tabId}:`, error);
        }
        
        // 然后发送消息执行截图任务
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

// 添加启动时恢复活动任务的功能
chrome.runtime.onStartup.addListener(restoreActiveTasks);
chrome.runtime.onInstalled.addListener(restoreActiveTasks);

// 恢复活动任务的函数
chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('Alarm triggered:', alarm.name);
    
    if (alarm.name.startsWith('task_')) {
        const taskId = alarm.name.split('_')[1];
        
        chrome.storage.local.get(['tasks', 'activeTasks'], (result) => {
            const tasks = result.tasks || {};
            const activeTasks = result.activeTasks || {};
            const task = tasks[taskId];
            const activeInfo = activeTasks[taskId];
            
            if (task && task.active && activeInfo && activeInfo.tabId) {
                console.log(`Executing alarm task ${taskId} for tab ${activeInfo.tabId}`);
                executeTask(task, activeInfo.tabId);
                
                // 更新最后执行时间
                activeTasks[taskId].lastRun = Date.now();
                chrome.storage.local.set({ activeTasks });
            } else {
                console.log(`Task ${taskId} is no longer active, clearing alarm`);
                chrome.alarms.clear(alarm.name);
            }
        });
    }
});

// 修改 restoreActiveTasks 函数，使用 alarms API
function restoreActiveTasks() {
    console.log('Restoring active tasks...');
    chrome.storage.local.get(['tasks', 'activeTasks'], (result) => {
        const tasks = result.tasks || {};
        const activeTasks = result.activeTasks || {};
        
        // 清除所有现有的 alarms
        chrome.alarms.clearAll();
        
        // 遍历所有活动任务
        Object.keys(activeTasks).forEach(taskId => {
            const task = tasks[taskId];
            const activeInfo = activeTasks[taskId];
            
            if (task && task.active && activeInfo.tabId) {
                console.log(`Restoring task ${taskId} for tab ${activeInfo.tabId}`);
                
                // 检查标签页是否仍然存在
                chrome.tabs.get(activeInfo.tabId, (tab) => {
                    if (!chrome.runtime.lastError && tab) {
                        // 创建新的 alarm
                        chrome.alarms.create(`task_${taskId}`, {
                            periodInMinutes: task.interval / (60 * 1000),
                            delayInMinutes: task.interval / (60 * 1000)
                        });
                        
                        console.log(`Alarm created for task ${taskId} with interval ${task.interval}ms`);
                    } else {
                        // 标签页不存在，清除任务状态
                        console.log(`Tab ${activeInfo.tabId} for task ${taskId} no longer exists`);
                        delete activeTasks[taskId];
                        task.active = false;
                        chrome.storage.local.set({ 
                            activeTasks,
                            tasks
                        });
                    }
                });
            }
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'postToIbbot') {
    (async () => {
      try {
        const url = request.url;
        const token = request.token || '';
        const payload = request.payload || {};
        if (!url) throw new Error('ibbot URL 未配置');
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(token ? { 'token': token } : {})
          },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        sendResponse({ success: true, data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  return true;
});