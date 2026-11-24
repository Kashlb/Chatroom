
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

// FIREBASE SETTINGS
const firebaseConfig = {
  apiKey: "AIzaSyCHdwah4QM6Loegm-6GssEMyq_oYIUpnEY",
  authDomain: "chatroom-website-b704b.firebaseapp.com",
  databaseURL: "https://chatroom-website-b704b-default-rtdb.firebaseio.com",
  projectId: "chatroom-website-b704b",
  storageBucket: "chatroom-website-b704b.firebasestorage.app",
  messagingSenderId: "1090177216314",
  appId: "1:1090177216314:web:7a4934f767a9d490af2a03"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let currentRoom = "";
let currentName = "";
let currentRole = "";
let listeners = [];
let waitingListener = null;

// SHORTCUTS
const $ = id => document.getElementById(id);

function status(message) {
  $("statusMessage").textContent = message;
}

function showScreen(id) {
  document.querySelectorAll("main > section").forEach(section => {
    section.classList.add("hidden");
  });
  $(id).classList.remove("hidden");
  status("");
}

function listen(path, callback) {
  const unsubscribe = onValue(ref(db, path), snapshot => {
    callback(snapshot.val());
  });
  listeners.push(unsubscribe);
}

function stopListeners() {
  listeners.forEach(unsubscribe => unsubscribe());
  listeners = [];
}

function cleanCode(code) {
  return code.trim().toUpperCase();
}

function makeCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function safeText(value) {
  return String(value ?? "");
}

// STARTUP
try {
  const result = await signInAnonymously(auth);
  currentUser = result.user;
} catch (error) {
  status("Could not connect to Firebase: " + error.message);
}

// NAVIGATION
$("showCreateButton").onclick = () => showScreen("createScreen");
$("showJoinButton").onclick = () => showScreen("joinScreen");
$("hostLoginButton").onclick = () => showScreen("hostLoginScreen");
$("cohostLoginButton").onclick = () => showScreen("cohostLoginScreen");

document.querySelectorAll(".backButton").forEach(button => {
  button.onclick = () => showScreen("homeScreen");
});

// CREATE ROOM
$("createForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    status("Still connecting. Please try again.");
    return;
  }

  const name = $("hostName").value.trim();
  const roomName = $("roomName").value.trim();
  const hostPin = $("createPin").value;
  const cohostPin = $("createCohostPin").value;

  if (!name || !roomName || hostPin.length < 4) {
    status("Please complete the required fields. Your PIN must be at least 4 characters.");
    return;
  }

  if (cohostPin && cohostPin.length < 4) {
    status("The co-host PIN must be at least 4 characters.");
    return;
  }

  try {
    let code = makeCode();

    while ((await get(ref(db, "roomInfo/" + code))).exists()) {
      code = makeCode();
    }

    await set(ref(db, "roomInfo/" + code), {
      name: roomName,
      hostName: name,
      hostUid: currentUser.uid,
      hostPin: hostPin,
      cohostPin: cohostPin || "",
      cohostUid: "",
      settings: {
        allowMessages: true,
        showMembers: true
      },
      createdAt: Date.now()
    });

    await set(ref(db, `roomMembers/${code}/${currentUser.uid}`), {
      name,
      role: "host",
      joinedAt: Date.now()
    });

    enterRoom(code, name, "host");
  } catch (error) {
    status("Could not create room: " + error.message);
  }
});

// JOIN ROOM - GUESTS ONLY NEED NAME AND CODE
$("joinForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    status("Still connecting. Please try again.");
    return;
  }

  const name = $("joinName").value.trim();
  const code = cleanCode($("roomCode").value);

  if (!name || !code) {
    status("Enter your name and room code.");
    return;
  }

  try {
    const roomSnapshot = await get(ref(db, "roomInfo/" + code));

    if (!roomSnapshot.exists()) {
      status("That room could not be found.");
      return;
    }

    const existingMember = await get(
      ref(db, `roomMembers/${code}/${currentUser.uid}`)
    );

    if (existingMember.exists()) {
      enterRoom(code, name, existingMember.val().role || "member");
      return;
    }

    const requestRef = ref(db, `roomRequests/${code}/${currentUser.uid}`);

    await set(requestRef, {
      uid: currentUser.uid,
      name,
      requestedAt: Date.now()
    });

    currentRoom = code;
    currentName = name;
    showScreen("waitingScreen");
    status("Your request has been sent.");

    if (waitingListener) waitingListener();

    waitingListener = onValue(
      ref(db, `roomDecisions/${code}/${currentUser.uid}`),
      async snapshot => {
        const decision = snapshot.val();

        if (decision === "approved") {
          waitingListener?.();
          waitingListener = null;
          await remove(ref(db, `roomDecisions/${code}/${currentUser.uid}`));
          enterRoom(code, name, "member");
        }

        if (decision === "declined") {
          waitingListener?.();
          waitingListener = null;
          await remove(ref(db, `roomDecisions/${code}/${currentUser.uid}`));
          await remove(requestRef);
          currentRoom = "";
          showScreen("homeScreen");
          status("Your request was declined.");
        }
      }
    );
  } catch (error) {
    status("Could not request to join: " + error.message);
  }
});

// HOST LOGIN
$("hostLoginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const code = cleanCode($("hostLoginCode").value);
  const pin = $("hostLoginPin").value;

  try {
    const snapshot = await get(ref(db, "roomInfo/" + code));

    if (!snapshot.exists()) {
      status("Room not found.");
      return;
    }

    const room = snapshot.val();

    if (room.hostPin !== pin) {
      status("Incorrect host PIN.");
      return;
    }

    await update(ref(db, "roomInfo/" + code), {
      hostUid: currentUser.uid
    });

    await set(ref(db, `roomMembers/${code}/${currentUser.uid}`), {
      name: room.hostName,
      role: "host",
      joinedAt: Date.now()
    });

    enterRoom(code, room.hostName, "host");
  } catch (error) {
    status("Host login failed: " + error.message);
  }
});

// CO-HOST LOGIN
$("cohostLoginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const code = cleanCode($("cohostLoginCode").value);
  const pin = $("cohostLoginPin").value;

  try {
    const snapshot = await get(ref(db, "roomInfo/" + code));

    if (!snapshot.exists()) {
      status("Room not found.");
      return;
    }

    const room = snapshot.val();

    if (!room.cohostPin || room.cohostPin !== pin) {
      status("Incorrect co-host PIN.");
      return;
    }

    await update(ref(db, "roomInfo/" + code), {
      cohostUid: currentUser.uid
    });

    await set(ref(db, `roomMembers/${code}/${currentUser.uid}`), {
      name: "Co-host",
      role: "cohost",
      joinedAt: Date.now()
    });

    enterRoom(code, "Co-host", "cohost");
  } catch (error) {
    status("Co-host login failed: " + error.message);
  }
});

// ENTER ROOM
function enterRoom(code, name, role) {
  stopListeners();

  currentRoom = code;
  currentName = name;
  currentRole = role;

  showScreen("chatScreen");

  $("displayRoomCode").textContent = code;

  listen(`roomInfo/${code}`, room => {
    if (!room) {
      leaveRoom(false);
      status("This room has been closed.");
      return;
    }

    $("displayRoomName").textContent = room.name || "Chatroom";

    if (role === "host") {
      $("hostPanel").classList.remove("hidden");
      $("requestsPanel").classList.remove("hidden");
      $("allowMessages").checked = room.settings?.allowMessages !== false;
      $("showMembers").checked = room.settings?.showMembers !== false;
    } else {
      $("hostPanel").classList.add("hidden");
    }

    if (role === "host" || role === "cohost") {
      $("requestsPanel").classList.remove("hidden");
    } else {
      $("requestsPanel").classList.add("hidden");
    }

    $("membersPanel").classList.toggle(
      "hidden",
      room.settings?.showMembers === false && role === "member"
    );

    if (role === "host" && room.hostUid !== currentUser.uid) {
      status("Host access has been transferred to another login.");
    }
  });

  listen(`roomMessages/${code}`, messages => {
    displayMessages(messages || {});
  });

  listen(`roomMembers/${code}`, members => {
    displayMembers(members || {});
  });

  if (role === "host" || role === "cohost") {
    listen(`roomRequests/${code}`, requests => {
      displayRequests(requests || {});
    });
  }
}

// DISPLAY MESSAGES
function displayMessages(messages) {
  const box = $("messages");
  box.innerHTML = "";

  const entries = Object.entries(messages)
    .sort((a, b) => (a[1].sentAt || 0) - (b[1].sentAt || 0));

  if (entries.length === 0) {
    box.textContent = "No messages yet.";
    return;
  }

  entries.forEach(([id, message]) => {
    const item = document.createElement("div");
    item.className = "message";

    const sender = document.createElement("strong");
    sender.textContent = safeText(message.name) + ": ";

    const content = document.createElement("span");
    content.textContent = safeText(message.text);

    const time = document.createElement("small");
    time.textContent = message.sentAt
      ? new Date(message.sentAt).toLocaleTimeString()
      : "";

    item.append(sender, content, time);
    box.appendChild(item);
  });

  box.scrollTop = box.scrollHeight;
}

// DISPLAY MEMBERS
function displayMembers(members) {
  const box = $("membersList");
  const cohosts = $("cohostList");

  box.innerHTML = "";
  cohosts.innerHTML = "";

  Object.entries(members).forEach(([uid, member]) => {
    const item = document.createElement("div");
    item.className = "member";
    item.textContent = safeText(member.name) + " (" + safeText(member.role) + ")";

    if (currentRole === "host" && uid !== currentUser.uid) {
      const removeButton = document.createElement("button");
      removeButton.textContent = "Remove";
      removeButton.className = "danger";
      removeButton.onclick = async () => {
        await remove(ref(db, `roomMembers/${currentRoom}/${uid}`));
      };
      item.appendChild(removeButton);
    }

    box.appendChild(item);

    if (member.role === "cohost") {
      const cohostItem = document.createElement("div");
      cohostItem.textContent = safeText(member.name) + " is a co-host";
      cohosts.appendChild(cohostItem);
    }
  });
}

// DISPLAY JOIN REQUESTS
function displayRequests(requests) {
  const box = $("requestsList");
  box.innerHTML = "";

  const entries = Object.entries(requests);

  if (entries.length === 0) {
    box.textContent = "No pending requests.";
    return;
  }

  entries.forEach(([uid, request]) => {
    const item = document.createElement("div");
    item.className = "request";

    const name = document.createElement("span");
    name.textContent = safeText(request.name);

    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.onclick = async () => {
      await set(ref(db, `roomMembers/${currentRoom}/${uid}`), {
        name: request.name,
        role: "member",
        joinedAt: Date.now()
      });

      await set(ref(db, `roomDecisions/${currentRoom}/${uid}`), "approved");
      await remove(ref(db, `roomRequests/${currentRoom}/${uid}`));
    };

    const decline = document.createElement("button");
    decline.textContent = "Decline";
    decline.className = "secondary";
    decline.onclick = async () => {
      await set(ref(db, `roomDecisions/${currentRoom}/${uid}`), "declined");
      await remove(ref(db, `roomRequests/${currentRoom}/${uid}`));
    };

    item.append(name, approve, decline);
    box.appendChild(item);
  });
}

// SEND MESSAGE
$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();

  const text = $("messageInput").value.trim();
  if (!text || !currentRoom) return;

  try {
    const roomSnapshot = await get(ref(db, `roomInfo/${currentRoom}`));
    const room = roomSnapshot.val();

    if (!room || room.settings?.allowMessages === false) {
      status("Messaging is currently disabled.");
      return;
    }

    const memberSnapshot = await get(
      ref(db, `roomMembers/${currentRoom}/${currentUser.uid}`)
    );

    if (!memberSnapshot.exists()) {
      status("You are no longer a member of this room.");
      return;
    }

    await push(ref(db, `roomMessages/${currentRoom}`), {
      uid: currentUser.uid,
      name: currentName,
      text,
      sentAt: Date.now()
    });

    $("messageInput").value = "";
    status("");
  } catch (error) {
    status("Could not send message: " + error.message);
  }
});

// SAVE ROOM SETTINGS
$("saveSettingsButton").onclick = async () => {
  if (currentRole !== "host") return;

  try {
    await update(ref(db, `roomInfo/${currentRoom}/settings`), {
      allowMessages: $("allowMessages").checked,
      showMembers: $("showMembers").checked
    });
    status("Settings saved.");
  } catch (error) {
    status("Could not save settings: " + error.message);
  }
};

// CLOSE ROOM
$("closeRoomButton").onclick = async () => {
  if (currentRole !== "host") return;

  if (!confirm("Close this room for everyone? This cannot be undone.")) {
    return;
  }

  try {
    const code = currentRoom;

    await remove(ref(db, `roomInfo/${code}`));
    await remove(ref(db, `roomMembers/${code}`));
    await remove(ref(db, `roomRequests/${code}`));
    await remove(ref(db, `roomDecisions/${code}`));
    await remove(ref(db, `roomMessages/${code}`));

    leaveRoom(false);
    status("Room closed.");
  } catch (error) {
    status("Could not close room: " + error.message);
  }
};

// CANCEL JOIN REQUEST
$("cancelRequestButton").onclick = async () => {
  if (waitingListener) waitingListener();
  waitingListener = null;

  if (currentRoom && currentUser) {
    await remove(ref(db, `roomRequests/${currentRoom}/${currentUser.uid}`));
    await remove(ref(db, `roomDecisions/${currentRoom}/${currentUser.uid}`));
  }

  currentRoom = "";
  showScreen("homeScreen");
};

// LEAVE ROOM
async function leaveRoom(showHome = true) {
  stopListeners();

  if (waitingListener) waitingListener();
  waitingListener = null;

  if (currentRoom && currentUser && currentRole === "member") {
    await remove(ref(db, `roomMembers/${currentRoom}/${currentUser.uid}`));
  }

  // Host and co-host access stays saved so they can log in again.
  currentRoom = "";
  currentName = "";
  currentRole = "";

  if (showHome) showScreen("homeScreen");
}

$("leaveButton").onclick = () => leaveRoom(true);

// INITIAL SCREEN
showScreen("homeScreen");
