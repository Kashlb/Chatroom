
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  onDisconnect
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

// FIREBASE SETTINGS
const firebaseConfig = {
  apiKey: "AIzaSyCHdwah4QM6Loegm-6GssEMyq_oYIUpnEY",
  authDomain: "chatroom-website-b704b.firebaseapp.com",
  databaseURL: "https://chatroom-website-b704b-default-rtdb.firebaseio.com",
  projectId: "chatroom-website-b704b",
  storageBucket: "chatroom-website-b704b.firebasestorage.app",
  messagingSenderId: "109017721631",
  appId: "1:109017721631:web:7a4934f767a9d490af2a03"
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

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function safeText(value) {
  return String(value ?? "");
}

// DELETE ENTIRE ROOM
async function deleteRoom(roomId) {
  await Promise.all([
    remove(ref(db, `roomInfo/${roomId}`)),
    remove(ref(db, `roomMembers/${roomId}`)),
    remove(ref(db, `roomRequests/${roomId}`)),
    remove(ref(db, `roomDecisions/${roomId}`)),
    remove(ref(db, `roomMessages/${roomId}`))
  ]);
}

// CHECK FOR EMPTY ROOMS
async function cleanupEmptyRooms() {
  try {
    const roomsSnapshot = await get(ref(db, "roomInfo"));

    if (!roomsSnapshot.exists()) return;

    const rooms = roomsSnapshot.val();

    for (const [id, room] of Object.entries(rooms)) {
      // Give newly created rooms time to finish setup
      if (Date.now() - (room.createdAt || 0) < 15000) continue;

      const membersSnapshot = await get(
        ref(db, `roomMembers/${id}`)
      );

      if (!membersSnapshot.exists()) {
        await deleteRoom(id);
      }
    }
  } catch (error) {
    console.error("Room cleanup error:", error);
  }
}

// FIND A ROOM BY ITS NAME
async function findRoomByName(name) {
  await cleanupEmptyRooms();

  const snapshot = await get(ref(db, "roomInfo"));

  if (!snapshot.exists()) return null;

  const wantedName = normalizeName(name);
  const rooms = snapshot.val();

  for (const [id, room] of Object.entries(rooms)) {
    if (normalizeName(room.name || "") === wantedName) {
      return { id, room };
    }
  }

  return null;
}

// CONNECT TO FIREBASE
try {
  const result = await signInAnonymously(auth);
  currentUser = result.user;

  listen("roomInfo", rooms => {
    displayAvailableRooms(rooms || {});
  });

  cleanupEmptyRooms();

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

// DISPLAY AVAILABLE ROOMS
function displayAvailableRooms(rooms) {
  const box = $("availableRooms");
  box.innerHTML = "";

  const entries = Object.entries(rooms);

  if (entries.length === 0) {
    box.textContent = "There are no rooms available right now.";
    return;
  }

  entries.forEach(([id, room]) => {
    const item = document.createElement("div");
    item.className = "member";

    const name = document.createElement("strong");
    name.textContent = safeText(room.name);

    const joinButton = document.createElement("button");
    joinButton.textContent = "Join";
    joinButton.onclick = () => {
      $("joinRoomName").value = room.name;
      showScreen("joinScreen");
    };

    item.append(name, joinButton);
    box.appendChild(item);
  });
}

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
    status("Please complete the fields. The host PIN must be at least 4 characters.");
    return;
  }

  if (cohostPin && cohostPin.length < 4) {
    status("The co-host PIN must be at least 4 characters.");
    return;
  }

  try {
    const existingRoom = await findRoomByName(roomName);

    if (existingRoom) {
      status("That room name is already being used. Choose another name.");
      return;
    }

    const roomRef = push(ref(db, "roomInfo"));
    const roomId = roomRef.key;

    await set(roomRef, {
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

    await set(ref(db, `roomMembers/${roomId}/${currentUser.uid}`), {
      name,
      role: "host",
      joinedAt: Date.now()
    });

    $("createForm").reset();
    enterRoom(roomId, name, "host");

  } catch (error) {
    status("Could not create room: " + error.message);
  }
});

// GUEST JOIN REQUEST
$("joinForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    status("Still connecting. Please try again.");
    return;
  }

  const name = $("joinName").value.trim();
  const roomName = $("joinRoomName").value.trim();

  if (!name || !roomName) {
    status("Enter your name and the room name.");
    return;
  }

  try {
    const found = await findRoomByName(roomName);

    if (!found) {
      status("We couldn't find that room.");
      return;
    }

    const roomId = found.id;

    const memberSnapshot = await get(
      ref(db, `roomMembers/${roomId}/${currentUser.uid}`)
    );

    if (memberSnapshot.exists()) {
      enterRoom(roomId, name, memberSnapshot.val().role || "member");
      return;
    }

    const requestRef = ref(
      db,
      `roomRequests/${roomId}/${currentUser.uid}`
    );

    await set(requestRef, {
      uid: currentUser.uid,
      name,
      requestedAt: Date.now()
    });

    currentRoom = roomId;
    currentName = name;

    showScreen("waitingScreen");
    status("Your request has been sent.");

    if (waitingListener) waitingListener();

    waitingListener = onValue(
      ref(db, `roomDecisions/${roomId}/${currentUser.uid}`),
      async snapshot => {
        const decision = snapshot.val();

        if (decision === "approved") {
          waitingListener?.();
          waitingListener = null;

          await remove(
            ref(db, `roomDecisions/${roomId}/${currentUser.uid}`)
          );

          enterRoom(roomId, name, "member");
        }

        if (decision === "declined") {
          waitingListener?.();
          waitingListener = null;

          await remove(requestRef);
          await remove(
            ref(db, `roomDecisions/${roomId}/${currentUser.uid}`)
          );

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

  const roomName = $("hostLoginRoomName").value.trim();
  const pin = $("hostLoginPin").value;

  try {
    const found = await findRoomByName(roomName);

    if (!found) {
      status("Room not found.");
      return;
    }

    const { id, room } = found;

    if (room.hostPin !== pin) {
      status("Incorrect host PIN.");
      return;
    }

    await update(ref(db, `roomInfo/${id}`), {
      hostUid: currentUser.uid
    });

    await set(ref(db, `roomMembers/${id}/${currentUser.uid}`), {
      name: room.hostName,
      role: "host",
      joinedAt: Date.now()
    });

    $("hostLoginForm").reset();
    enterRoom(id, room.hostName, "host");

  } catch (error) {
    status("Host login failed: " + error.message);
  }
});

// CO-HOST LOGIN
$("cohostLoginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const roomName = $("cohostLoginRoomName").value.trim();
  const pin = $("cohostLoginPin").value;

  try {
    const found = await findRoomByName(roomName);

    if (!found) {
      status("Room not found.");
      return;
    }

    const { id, room } = found;

    if (!room.cohostPin || room.cohostPin !== pin) {
      status("Incorrect co-host PIN.");
      return;
    }

    await update(ref(db, `roomInfo/${id}`), {
      cohostUid: currentUser.uid
    });

    await set(ref(db, `roomMembers/${id}/${currentUser.uid}`), {
      name: "Co-host",
      role: "cohost",
      joinedAt: Date.now()
    });

    $("cohostLoginForm").reset();
    enterRoom(id, "Co-host", "cohost");

  } catch (error) {
    status("Co-host login failed: " + error.message);
  }
});

// ENTER ROOM
async function enterRoom(roomId, name, role) {
  stopListeners();

  if (waitingListener) waitingListener();
  waitingListener = null;

  currentRoom = roomId;
  currentName = name;
  currentRole = role;

  const memberRef = ref(
    db,
    `roomMembers/${roomId}/${currentUser.uid}`
  );

  // Remove member automatically if browser disconnects
  await onDisconnect(memberRef).remove();

  showScreen("chatScreen");

  listen(`roomInfo/${roomId}`, room => {
    if (!room) {
      leaveRoom(false);
      status("This room has been closed.");
      return;
    }

    $("displayRoomName").textContent = room.name || "Chatroom";

    $("hostPanel").classList.toggle("hidden", role !== "host");

    $("requestsPanel").classList.toggle(
      "hidden",
      role !== "host" && role !== "cohost"
    );

    $("allowMessages").checked =
      room.settings?.allowMessages !== false;

    $("showMembers").checked =
      room.settings?.showMembers !== false;

    $("membersPanel").classList.toggle(
      "hidden",
      room.settings?.showMembers === false && role === "member"
    );

    if (role === "host" && room.hostUid !== currentUser.uid) {
      status("Host access has been transferred to another login.");
    }
  });

  listen(`roomMessages/${roomId}`, messages => {
    displayMessages(messages || {});
  });

  listen(`roomMembers/${roomId}`, members => {
    const currentMembers = members || {};

    displayMembers(currentMembers);

    if (Object.keys(currentMembers).length === 0) {
      deleteRoom(roomId).catch(console.error);
    }
  });

  if (role === "host" || role === "cohost") {
    listen(`roomRequests/${roomId}`, requests => {
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
    item.textContent =
      safeText(member.name) + " (" + safeText(member.role) + ")";

    if (currentRole === "host" && uid !== currentUser.uid) {
      const removeButton = document.createElement("button");
      removeButton.textContent = "Remove";
      removeButton.className = "danger";

      removeButton.onclick = async () => {
        await remove(ref(db, `roomMembers/${currentRoom}/${uid}`));

        if (member.role === "cohost") {
          await update(ref(db, `roomInfo/${currentRoom}`), {
            cohostUid: ""
          });
        }
      };

      item.appendChild(removeButton);
    }

    box.appendChild(item);

    if (member.role === "cohost") {
      const cohostItem = document.createElement("div");
      cohostItem.textContent =
        safeText(member.name) + " is a co-host";
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

  const messageText = $("messageInput").value.trim();

  if (!messageText || !currentRoom) return;

  try {
    const roomSnapshot = await get(
      ref(db, `roomInfo/${currentRoom}`)
    );

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
      text: messageText,
      sentAt: Date.now()
    });

    $("messageInput").value = "";
    status("");

  } catch (error) {
    status("Could not send message: " + error.message);
  }
});

// SAVE SETTINGS
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
    const id = currentRoom;

    await deleteRoom(id);
    await leaveRoom(false);

    status("Room closed.");

  } catch (error) {
    status("Could not close room: " + error.message);
  }
};

// CANCEL REQUEST
$("cancelRequestButton").onclick = async () => {
  if (waitingListener) waitingListener();
  waitingListener = null;

  if (currentRoom && currentUser) {
    await remove(
      ref(db, `roomRequests/${currentRoom}/${currentUser.uid}`)
    );

    await remove(
      ref(db, `roomDecisions/${currentRoom}/${currentUser.uid}`)
    );
  }

  currentRoom = "";
  showScreen("homeScreen");
};

// LEAVE ROOM
async function leaveRoom(showHome = true) {
  const id = currentRoom;
  const uid = currentUser?.uid;

  stopListeners();

  if (waitingListener) waitingListener();
  waitingListener = null;

  if (id && uid) {
    try {
      const memberRef = ref(db, `roomMembers/${id}/${uid}`);

      await onDisconnect(memberRef).cancel();

      await remove(memberRef);

      const membersSnapshot = await get(
        ref(db, `roomMembers/${id}`)
      );

      if (!membersSnapshot.exists()) {
        await deleteRoom(id);
      }

    } catch (error) {
      console.error("Leave room error:", error);
    }
  }

  currentRoom = "";
  currentName = "";
  currentRole = "";

  if (showHome) showScreen("homeScreen");
}

$("leaveButton").onclick = () => leaveRoom(true);

// HOME SCREEN
showScreen("homeScreen");
