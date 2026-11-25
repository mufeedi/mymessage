// ============================================================
//  Chat app: Firebase Auth (accounts) + Firestore (messages)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, writeBatch,
  collection, query, where, orderBy, limitToLast, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

let mode = "login";        // "login" or "signup"
let me = null;             // { uid, username } of whoever is logged in
let signingUp = false;     // true while a sign-up is half done
let stopChatList = null;   // functions that switch off live listeners
let stopMessages = null;
let currentChatId = null;
const nameCache = {};      // uid -> username, so we don't re-fetch names

// ============================================================
//  1. AUTH: sign up, log in, log out
// ============================================================
function setMode(newMode) {
  mode = newMode;
  $("tab-login").classList.toggle("active", mode === "login");
  $("tab-signup").classList.toggle("active", mode === "signup");
  $("username").hidden = mode === "login";
  $("auth-submit").textContent = mode === "login" ? "Log in" : "Sign up";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-error").textContent = "";
}
$("tab-login").onclick = () => setMode("login");
$("tab-signup").onclick = () => setMode("signup");

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  $("auth-error").textContent = "";
  $("auth-submit").disabled = true;
  try {
    if (mode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged (below) takes it from here
    } else {
      await signUp(email, password, $("username").value.trim().toLowerCase());
    }
  } catch (err) {
    $("auth-error").textContent = friendlyError(err);
  }
  $("auth-submit").disabled = false;
});

async function signUp(email, password, username) {
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new Error("Username must be 3 to 20 characters: a-z, 0-9 or _");
  }
  signingUp = true;
  try {
    // Step 1: make the login account (Firebase Auth)
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Step 2: claim the username AND save the profile, both or neither
    const batch = writeBatch(db);
    batch.set(doc(db, "usernames", username), { uid: cred.user.uid });
    batch.set(doc(db, "users", cred.user.uid), { username, createdAt: serverTimestamp() });
    try {
      await batch.commit();
    } catch (err) {
      // username already taken: undo step 1 so the email can be reused
      await deleteUser(cred.user);
      throw new Error("That username is taken. Try another one.");
    }
    showApp(cred.user.uid, username);
  } finally {
    signingUp = false;
  }
}

// Runs on page load AND whenever someone logs in or out.
onAuthStateChanged(auth, async (user) => {
  if (signingUp) return;            // signUp() handles its own ending
  if (!user) return showAuth();
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    await signOut(auth);
    $("auth-error").textContent = "This account has no profile. Sign up with a different email.";
    return;
  }
  showApp(user.uid, snap.data().username);
});

$("logout-btn").onclick = () => {
  showAuth();          // switch off listeners first
  signOut(auth);
};

function showApp(uid, username) {
  me = { uid, username };
  nameCache[uid] = username;
  $("me-name").textContent = username;
  $("auth-screen").hidden = true;
  $("app-screen").hidden = false;
  listenToChatList();
}

function showAuth() {
  if (stopChatList) stopChatList();
  if (stopMessages) stopMessages();
  stopChatList = stopMessages = null;
  me = null;
  currentChatId = null;
  $("chat-list").replaceChildren();
  $("messages").replaceChildren();
  $("message-form").hidden = true;
  $("chat-title").textContent = "Pick a chat";
  document.body.classList.remove("in-chat");
  $("app-screen").hidden = true;
  $("auth-screen").hidden = false;
}

function friendlyError(err) {
  const messages = {
    "auth/invalid-email": "That email doesn't look right.",
    "auth/email-already-in-use": "That email already has an account. Log in instead.",
    "auth/weak-password": "Password needs at least 6 characters.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
  };
  return messages[err.code] || err.message;
}

// ============================================================
//  2. FINDING FRIENDS + the chat list
// ============================================================
// Two people always get the SAME chat id, whoever starts it.
function chatIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

async function getUsername(uid) {
  if (!nameCache[uid]) {
    const snap = await getDoc(doc(db, "users", uid));
    nameCache[uid] = snap.exists() ? snap.data().username : "unknown";
  }
  return nameCache[uid];
}

$("add-friend-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("friend-input").value.trim().toLowerCase();
  $("friend-error").textContent = "";
  if (name === me.username) {
    $("friend-error").textContent = "That's you!";
    return;
  }
  try {
    const snap = await getDoc(doc(db, "usernames", name));
    if (!snap.exists()) {
      $("friend-error").textContent = "No one has that username.";
      return;
    }
    $("friend-input").value = "";
    openChat(snap.data().uid, name);
  } catch (err) {
    $("friend-error").textContent = err.message;
  }
});

// Live list of every chat I'm a member of.
function listenToChatList() {
  const q = query(collection(db, "chats"), where("members", "array-contains", me.uid));
  stopChatList = onSnapshot(q, async (snap) => {
    const chats = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    // newest activity first
    chats.sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0));
    const friendUids = chats.map((c) => c.members.find((m) => m !== me.uid));
    const names = await Promise.all(friendUids.map(getUsername));

    $("chat-list").replaceChildren(...chats.map((chat, i) => {
      const li = document.createElement("li");
      if (chat.id === currentChatId) li.classList.add("active");
      const name = document.createElement("b");
      name.textContent = names[i];
      const preview = document.createElement("div");
      preview.className = "preview";
      preview.textContent = chat.lastMessage || "No messages yet";
      li.append(name, preview);
      li.onclick = () => openChat(friendUids[i], names[i]);
      return li;
    }));
  }, (err) => console.error("Chat list error:", err));
}

// ============================================================
//  3. OPENING A CHAT + listening for messages in real time
// ============================================================
async function openChat(friendUid, friendName) {
  const chatId = chatIdFor(me.uid, friendUid);
  if (stopMessages) stopMessages();
  stopMessages = null;
  currentChatId = chatId;
  nameCache[friendUid] = friendName;

  $("chat-title").textContent = friendName;
  $("messages").replaceChildren();
  $("message-form").hidden = false;
  document.body.classList.add("in-chat");
  document.querySelectorAll("#chat-list li").forEach((li) =>
    li.classList.toggle("active", li.querySelector("b").textContent === friendName));

  // Make sure the chat document exists (creates it the first time, harmless after).
  await setDoc(doc(db, "chats", chatId), { members: [me.uid, friendUid].sort() }, { merge: true });
  if (currentChatId !== chatId) return; // user clicked another chat meanwhile

  // The live listener: Firebase calls this function every time a message is added.
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt"), limitToLast(100));
  stopMessages = onSnapshot(q, (snap) => {
    const box = $("messages");
    box.replaceChildren(...snap.docs.map((d) => makeMessage(d.data({ serverTimestamps: "estimate" }))));
    box.scrollTop = box.scrollHeight;
  }, (err) => console.error("Messages error:", err));
}

function makeMessage(msg) {
  const div = document.createElement("div");
  div.className = "msg " + (msg.senderId === me.uid ? "mine" : "theirs");
  const text = document.createElement("p");
  text.textContent = msg.text;        // textContent, never innerHTML: stops code injection
  const time = document.createElement("small");
  time.textContent = msg.createdAt
    ? msg.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  div.append(text, time);
  return div;
}

$("back-btn").onclick = () => document.body.classList.remove("in-chat");

// ============================================================
//  4. SENDING a message
// ============================================================
$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("message-input");
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  input.value = "";
  const chatId = currentChatId;
  try {
    await addDoc(collection(db, "chats", chatId, "messages"), {
      senderId: me.uid,
      text,
      createdAt: serverTimestamp(),   // Google's clock, not the user's
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: text.slice(0, 60),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Send failed:", err);
    input.value = text; // give the text back so it isn't lost
  }
});
