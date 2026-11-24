
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";


// YOUR FIREBASE CONFIGURATION

const firebaseConfig = {
  apiKey: "AIzaSyCHdwah4QM6Loegm-6GssEMyq_oYIUpnEY",
  authDomain: "chatroom-website-b704b.firebaseapp.com",
  databaseURL: "https://chatroom-website-b704b-default-rtdb.firebaseio.com",
  projectId: "chatroom-website-b704b",
  storageBucket: "chatroom-website-b704b.firebasestorage.app",
  messagingSenderId: "1090177216314",
  appId: "1:1090177216314:web:7a4934f767a9d490af2a03"
};


// START FIREBASE

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);


// CURRENT USER

let currentUser = null;
let currentRoom = null;
let currentRole = null;
let currentName = null;
let listeners = [];
let requestKey = null;


// PAGE ELEMENTS

const $ = id => document.getElementById(id);

function showScreen(id) {
  [
    "homeScreen",
    "createScreen",
    "joinScreen",
    "waitingScreen",
    "chatScreen"
  ].forEach(screen => $(screen).classList.add("hidden"));

  $(id).classList.remove("hidden");
}

function status(message) {
  $("statusMessage").textContent = message;
}

function listen(path, callback) {
  const unsubscribe = onValue(ref(db, path), callback);
  listeners.push(unsubscribe);
}

function stopListeners() {
  listeners.forEach(unsubscribe => unsubscribe());
  listeners = [];
}


// RANDOM ROOM CODE

function makeCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}


// SIMPLE PIN HASH

async function hashPin(pin) {
  const data = new TextEncoder().encode(pin);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}


// START AUTHENTICATION

async function start() {
  try {
    const result = await signInAnonymously(auth);
    currentUser = result.user;
    status("Connected to Chatroom.");
  } catch (error) {
    status("Firebase login error: " + error.message);
  }
}

start();


// NAVIGATION

$("showCreateButton").onclick = () => {
  status("");
  showScreen("createScreen");
};

$("showJoinButton").onclick = () => {
  status("");
  showScreen("joinScreen");
};

document.querySelectorAll(".backButton").forEach(button => {
  button.onclick = () => {
    status("");
    showScreen("homeScreen");
  };
});


// CREATE ROOM

$("createForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    status("Please wait for Firebase to connect.");
    return;
  }

  const name = $("hostName").value.trim();
  const roomName = $("roomName").value.trim();
  const pin = $("createPin").value.trim();

  if (!name || !roomName || pin.length < 4) {
    status("Enter your name, room name, and a PIN of at least 4 characters.");
    return;
  }

  try {
    const code = makeCode();
    const pinHash = await hashPin(pin);

    await set(ref(db, "roomInfo/" + code), {
      name: roomName,
      hostUid: currentUser.uid,
      createdAt: Date.now(),
      settings: {
        allowMessages: true,
        showMembers: true
      }
    });

    await set(ref(db, "roomSecrets/" + code), {
      pinHash: pinHash
    });

    await set(ref(db, "roomMembers/" + code + "/" + currentUser.uid), {
      name: name,
      role: "host",
      joinedAt: Date.now()
    });

    currentRoom = code;
    currentName = name;
    currentRole = "host";

    $("createForm").reset();

    await enterRoom();

    status("Room created! Your room code is " + code);

  } catch (error) {
    status("Could not create room: " + error.message);
  }
});


// JOIN ROOM

$("joinForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) {
    status("Please wait for Firebase to connect.");
    return;
  }

  const name = $("joinName").value.trim();
  const code = $("roomCode").value.trim().toUpperCase();
  const pin = $("joinPin").value.trim();

  if (!name || !code || !pin) {
    status("Fill in all fields.");
    return;
  }

  try {
    const roomSnapshot = await get(ref(db, "roomInfo/" + code));

    if (!roomSnapshot.exists()) {
      status("Room not found.");
      return;
    }

    const pinHash = await hashPin(pin);
    const requestRef = push(ref(db, "roomRequests/" + code));

    await set(requestRef, {
      uid: currentUser.uid,
      name: name,
      pinHash: pinHash,
      requestedAt: Date.now()
    });

    currentRoom = code;
    currentName = name;
    requestKey = requestRef.key;

    $("joinForm").reset();

    showScreen("waitingScreen");
    status("Waiting for the host.");

    listen("roomDecisions/" + code + "/" + currentUser.uid, snapshot => {
      if (!snapshot.exists()) return;

      const decision = snapshot.val();

      if (decision.status === "approved") {
        stopListeners();

        currentRole = "member";

        enterRoom();
      }

      if (decision.status === "declined") {
        stopListeners();
        currentRoom = null;
        status("Your request was declined.");
        showScreen("homeScreen");
      }

      if (decision.status === "removed") {
        stopListeners();
        currentRoom = null;
        status("You were removed from the room.");
        showScreen("homeScreen");
      }
    });

  } catch (error) {
    status("Could not join: " + error.message);
  }
});


// CANCEL JOIN REQUEST

$("cancelRequestButton").onclick = async () => {
  try {
    if (requestKey && currentRoom) {
      await remove(
        ref(db, "roomRequests/" + currentRoom + "/" + requestKey)
      );
    }

    stopListeners();
    currentRoom = null;
    requestKey = null;

    showScreen("homeScreen");
    status("Request cancelled.");

  } catch (error) {
    status("Could not cancel: " + error.message);
  }
};


// ENTER ROOM

async function enterRoom() {
  stopListeners();

  const roomSnapshot = await get(ref(db, "roomInfo/" + currentRoom));

  if (!roomSnapshot.exists()) {
    status("This room no longer exists.");
    showScreen("homeScreen");
    return;
  }

  const room = roomSnapshot.val();

  $("displayRoomName").textContent = room.name;
  $("displayRoomCode").textContent = currentRoom;

  showScreen("chatScreen");

  $("hostPanel").classList.toggle("hidden", currentRole !== "host");
  $("requestsPanel").classList.toggle("hidden", currentRole === "member");

  listen("roomMessages/" + currentRoom, snapshot => {
    renderMessages(snapshot.val() || {});
  });

  listen("roomMembers/" + currentRoom, snapshot => {
    renderMembers(snapshot.val() || {});
  });

  listen("roomInfo/" + currentRoom + "/settings", snapshot => {
    const settings = snapshot.val() || {};

    $("membersPanel").classList.toggle("hidden", settings.showMembers === false);
    $("messageInput").disabled = settings.allowMessages === false;
    $("messageForm").querySelector("button").disabled =
      settings.allowMessages === false;

    if (currentRole === "host") {
      $("allowMessages").checked = settings.allowMessages !== false;
      $("showMembers").checked = settings.showMembers !== false;
    }
  });

  if (currentRole !== "member") {
    listen("roomRequests/" + currentRoom, snapshot => {
      renderRequests(snapshot.val() || {});
    });
  }

  if (currentRole === "host" || currentRole === "cohost") {
    listen("roomMembers/" + currentRoom, snapshot => {
      renderCohosts(snapshot.val() || {});
    });
  }
}


// RENDER MESSAGES

function renderMessages(messages) {
  const box = $("messages");
  box.replaceChildren();

  const entries = Object.entries(messages)
    .sort((a, b) => (a[1].sentAt || 0) - (b[1].sentAt || 0))
    .slice(-100);

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "emptyMessage";
    empty.textContent = "No messages yet.";
    box.appendChild(empty);
    return;
  }

  entries.forEach(([id, message]) => {
    const item = document.createElement("div");
    item.className = "message";

    const author = document.createElement("strong");
    author.textContent = message.name || "Member";

    const content = document.createElement("div");
    content.textContent = message.text || "";

    const time = document.createElement("small");
    time.textContent = message.sentAt
      ? new Date(message.sentAt).toLocaleTimeString()
      : "";

    item.append(author, content, time);
    box.appendChild(item);
  });

  box.scrollTop = box.scrollHeight;
}


// SEND MESSAGE

$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();

  const text = $("messageInput").value.trim();

  if (!text || !currentRoom || !currentUser) return;

  try {
    await push(ref(db, "roomMessages/" + currentRoom), {
      uid: currentUser.uid,
      name: currentName,
      text: text,
      sentAt: Date.now()
    });

    $("messageInput").value = "";

  } catch (error) {
    status("Could not send message: " + error.message);
  }
});


// RENDER JOIN REQUESTS

function renderRequests(requests) {
  const box = $("requestsList");
  box.replaceChildren();

  Object.entries(requests).forEach(([key, request]) => {
    const row = document.createElement("div");
    row.className = "request";

    const name = document.createElement("span");
    name.textContent = request.name || "Guest";

    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.onclick = () => approveRequest(key, request);

    const decline = document.createElement("button");
    decline.textContent = "Decline";
    decline.className = "secondary";
    decline.onclick = () => declineRequest(key, request);

    row.append(name, approve, decline);
    box.appendChild(row);
  });
}


// APPROVE GUEST

async function approveRequest(key, request) {
  try {
    const secret = await get(ref(db, "roomSecrets/" + currentRoom + "/pinHash"));

    if (!secret.exists() || secret.val() !== request.pinHash) {
      status("Incorrect room PIN.");
      await remove(ref(db, "roomRequests/" + currentRoom + "/" + key));
      return;
    }

    const members = await get(ref(db, "roomMembers/" + currentRoom));

    const cohostExists = Object.values(members.val() || {})
      .some(member => member.role === "cohost");

    if (cohostExists && request.makeCohost) {
      status("A co-host is already assigned.");
      return;
    }

    await set(ref(db, "roomMembers/" + currentRoom + "/" + request.uid), {
      name: request.name,
      role: "member",
      joinedAt: Date.now()
    });

    await set(ref(db, "roomDecisions/" + currentRoom + "/" + request.uid), {
      status: "approved"
    });

    await remove(ref(db, "roomRequests/" + currentRoom + "/" + key));

    status("Guest approved.");

  } catch (error) {
    status("Approval failed: " + error.message);
  }
}


// DECLINE GUEST

async function declineRequest(key, request) {
  try {
    await set(ref(db, "roomDecisions/" + currentRoom + "/" + request.uid), {
      status: "declined"
    });

    await remove(ref(db, "roomRequests/" + currentRoom + "/" + key));

  } catch (error) {
    status("Could not decline request: " + error.message);
  }
}


// RENDER MEMBERS

function renderMembers(members) {
  const box = $("membersList");
  box.replaceChildren();

  Object.entries(members).forEach(([uid, member]) => {
    const row = document.createElement("div");
    row.className = "member";

    const name = document.createElement("span");
    name.textContent = member.name + " (" + member.role + ")";

    row.appendChild(name);

    if (currentRole === "host" && member.role !== "host") {
      const removeButton = document.createElement("button");
      removeButton.textContent = "Remove";
      removeButton.className = "danger";

      removeButton.onclick = () => removeMember(uid);

      row.appendChild(removeButton);
    }

    box.appendChild(row);
  });
}


// REMOVE MEMBER

async function removeMember(uid) {
  if (!confirm("Remove this member?")) return;

  try {
    await set(ref(db, "roomDecisions/" + currentRoom + "/" + uid), {
      status: "removed"
    });

    await remove(ref(db, "roomMembers/" + currentRoom + "/" + uid));

    status("Member removed.");

  } catch (error) {
    status("Could not remove member: " + error.message);
  }
}


// RENDER COHOST

function renderCohosts(members) {
  const box = $("cohostList");
  box.replaceChildren();

  Object.entries(members).forEach(([uid, member]) => {
    if (member.role === "cohost") {
      const item = document.createElement("p");
      item.textContent = member.name;
      box.appendChild(item);
    }
  });
}


// ASSIGN COHOST

$("assignCohostButton").onclick = async () => {
  if (currentRole !== "host") return;

  const members = await get(ref(db, "roomMembers/" + currentRoom));

  const cohostExists = Object.values(members.val() || {})
    .some(member => member.role === "cohost");

  if (cohostExists) {
    status("A co-host is already assigned.");
    return;
  }

  const name = prompt("Enter the exact name of the member to make co-host:");

  if (!name) return;

  const match = Object.entries(members.val() || {})
    .find(([uid, member]) => member.name === name && member.role === "member");

  if (!match) {
    status("Member not found.");
    return;
  }

  await update(ref(db, "roomMembers/" + currentRoom + "/" + match[0]), {
    role: "cohost"
  });

  status("Co-host assigned.");
};


// SAVE ROOM SETTINGS

$("saveSettingsButton").onclick = async () => {
  if (currentRole !== "host") return;

  try {
    await update(ref(db, "roomInfo/" + currentRoom + "/settings"), {
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

  if (!confirm("Close this room for everyone?")) return;

  try {
    await remove(ref(db, "roomMessages/" + currentRoom));
    await remove(ref(db, "roomRequests/" + currentRoom));
    await remove(ref(db, "roomDecisions/" + currentRoom));
    await remove(ref(db, "roomMembers/" + currentRoom));
    await remove(ref(db, "roomSecrets/" + currentRoom));
    await remove(ref(db, "roomInfo/" + currentRoom));

    stopListeners();

    currentRoom = null;
    currentRole = null;
    currentName = null;

    showScreen("homeScreen");
    status("Room closed.");

  } catch (error) {
    status("Could not close room: " + error.message);
  }
};


// LEAVE ROOM

$("leaveButton").onclick = async () => {
  try {
    stopListeners();

    if (currentRole !== "host" && currentRoom && currentUser) {
      await remove(ref(db, "roomMembers/" + currentRoom + "/" + currentUser.uid));
    }

    currentRoom = null;
    currentRole = null;
    currentName = null;

    showScreen("homeScreen");
    status("You left the room.");

  } catch (error) {
    status("Could not leave room: " + error.message);
  }
};
