import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signInAnonymously, signOut } from "firebase/auth";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot } from "firebase/firestore";
import { jsPDF } from "jspdf";
import 'jspdf-autotable';

export default function App() {
  // --- Core State ---
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [currentView, setCurrentView] = useState('dashboard');
  const [members, setMembers] = useState([]);
  const [adminsCount, setAdminsCount] = useState(0);
  const [theme, setTheme] = useState(localStorage.getItem('legends_theme') || 'dark');
  const [globalSearch, setGlobalSearch] = useState('');
  
  // --- UI State ---
  const [toast, setToast] = useState({ visible: false, title: '', message: '', type: 'success' });
  const [activeModal, setActiveModal] = useState(null);
  const [viewMember, setViewMember] = useState(null);
  
  // --- Form State ---
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regName, setRegName] = useState('');
  
  // Member Form State
  const [formData, setFormData] = useState({
    name: '', mobile: '', dob: '', gender: 'Male', address: '', height: '', weight: '',
    plan: '', joinDate: new Date().toISOString().split('T')[0], amount: '', paymode: 'Cash', trainer: '', notes: ''
  });
  const [editingId, setEditingId] = useState(null);
  const [editingFirestoreId, setEditingFirestoreId] = useState(null);

  // --- Clock ---
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Firebase Init & Listeners ---
  useEffect(() => {
    const initAuth = async () => {
      try { if(!currentUser) await signInAnonymously(auth); } 
      catch (e) { console.error(e); }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user && !user.isAnonymous) {
        setCurrentView('dashboard');
        
        // Listen to Members
        onSnapshot(collection(db, "members"), (snapshot) => {
          const mems = [];
          snapshot.forEach(doc => mems.push({ firestoreId: doc.id, ...doc.data() }));
          mems.sort((a,b) => b.id.localeCompare(a.id));
          setMembers(mems);
        });
      } else {
        // Check Admin Limit
        const snap = await getDocs(collection(db, "admins"));
        setAdminsCount(snap.size);
      }
    });
    return () => unsubscribe();
  }, []);

  // --- Utility Functions ---
  const showToastMsg = (title, message, type='success') => {
    setToast({ visible: true, title, message, type });
    setTimeout(() => setToast({ visible: false, title: '', message: '', type: 'success' }), 3000);
  };

  const calculateExpiry = (joinDateStr, plan) => {
    const date = new Date(joinDateStr);
    if (plan === '1 Month') date.setDate(date.getDate() + 30);
    else if (plan === '3 Months') date.setDate(date.getDate() + 90);
    else if (plan === '6 Months') date.setDate(date.getDate() + 180);
    else if (plan === '1 Year') date.setDate(date.getDate() + 365);
    return date.toISOString().split('T')[0];
  };

  const getStatus = (expiryDateStr) => {
    const today = new Date(); today.setHours(0,0,0,0);
    const exp = new Date(expiryDateStr); exp.setHours(0,0,0,0);
    const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'Expired';
    if (diffDays <= 7) return 'Expiring';
    return 'Active';
  };

  const formatDate = (dateStr) => {
    if(!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // --- Auth Handlers ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToastMsg('Cloud Login Validated', 'Access granted to system.', 'success');
    } catch (error) {
      showToastMsg('Access Denied', 'Invalid ID or Passkey.', 'error');
    }
    setLoading(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if(password.length < 6) return showToastMsg('Error', 'Passkey min 6 chars.', 'error');
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "admins"));
      if(snap.size >= 3) throw new Error("Maximum 3 Admins allowed.");
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "admins", userCred.user.uid), {
        name: regName, email: email, role: 'admin', createdAt: new Date().toISOString()
      });
      showToastMsg('Admin Registered', 'Account fully initialized.', 'success');
    } catch (error) {
      showToastMsg('Registration Failed', error.message, 'error');
    }
    setLoading(false);
  };

  // --- Member Handlers ---
  const handleMemberSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const expiryDate = calculateExpiry(formData.joinDate, formData.plan);
    const finalData = { ...formData, expiryDate };

    try {
      if (editingId && editingFirestoreId) {
        await updateDoc(doc(db, "members", editingFirestoreId), finalData);
        showToastMsg('Profile Updated', `${formData.name}'s data saved.`);
      } else {
        let maxId = 0;
        members.forEach(m => { const num = parseInt(m.id.replace('LG-', '')); if(num > maxId) maxId = num; });
        const newId = `LG-${(maxId + 1).toString().padStart(4, '0')}`;
        await addDoc(collection(db, "members"), { id: newId, ...finalData, createdAt: new Date().toISOString() });
        showToastMsg('Record Synced', `${formData.name} secured.`);
      }
      resetForm();
      setCurrentView('members-list');
    } catch (error) {
      showToastMsg('Save Failed', 'Network connection issue.', 'error');
    }
    setLoading(false);
  };

  const resetForm = () => {
    setEditingId(null); setEditingFirestoreId(null);
    setFormData({ name: '', mobile: '', dob: '', gender: 'Male', address: '', height: '', weight: '', plan: '', joinDate: new Date().toISOString().split('T')[0], amount: '', paymode: 'Cash', trainer: '', notes: '' });
  };

  const editMember = (m) => {
    setActiveModal(null);
    setEditingId(m.id); setEditingFirestoreId(m.firestoreId);
    setFormData({ ...m });
    setCurrentView('add-member');
  };

  const deleteMember = async () => {
    if(window.confirm('CRITICAL: Permanently delete this member?')) {
      try {
        await deleteDoc(doc(db, "members", viewMember.firestoreId));
        showToastMsg('Record Purged', 'Data permanently erased.', 'error');
        setActiveModal(null);
      } catch(e) { showToastMsg('Deletion Failed', 'Error.', 'error'); }
    }
  };

  const processRenewal = async () => {
    setLoading(true);
    const newExpiry = calculateExpiry(formData.joinDate, formData.plan);
    try {
      await updateDoc(doc(db, "members", viewMember.firestoreId), {
        plan: formData.plan, amount: formData.amount, joinDate: formData.joinDate, expiryDate: newExpiry
      });
      showToastMsg('Renewal Success', `Expiry shifted to ${formatDate(newExpiry)}`);
      setActiveModal(null);
    } catch(e) { showToastMsg('Failed', 'Error updating cloud.', 'error'); }
    setLoading(false);
  };

  // --- PDF Generators ---
  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("LEGENDS GYM", 14, 22);
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("Member Database Export", 130, 22);
    const data = members.map(m => [m.id, m.name, m.mobile, m.plan, formatDate(m.expiryDate), getStatus(m.expiryDate).toUpperCase()]);
    doc.autoTable({ startY: 35, head: [['ID', 'Name', 'Phone', 'Plan', 'Expiry', 'Status']], body: data, theme: 'grid' });
    doc.save(`Legends_DB_${new Date().toISOString().split('T')[0]}.pdf`);
    showToastMsg('Export Secure', 'PDF generated.');
  };

  const generateBill = () => {
    const doc = new jsPDF('p', 'mm', 'a5'); 
    doc.setFillColor(18, 18, 20); doc.rect(0, 0, 148, 30, 'F');
    doc.setTextColor(212, 175, 55); doc.setFontSize(22); doc.setFont("helvetica", "bold"); doc.text("LEGENDS GYM", 74, 16, { align: "center" });
    doc.setTextColor(0,0,0); doc.setFontSize(14); doc.text("MEMBERSHIP INVOICE", 74, 42, { align: "center" });
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`Name: ${viewMember.name.toUpperCase()}`, 16, 71);
    doc.text(`ID: ${viewMember.id} | Plan: ${viewMember.plan}`, 16, 77);
    doc.text(`Paid: Rs. ${viewMember.amount}/-`, 16, 83);
    doc.save(`Legends_Receipt_${viewMember.id}.pdf`);
    showToastMsg("Bill Generated", "Receipt processed.");
  };

  // ================= RENDER LOGIC =================

  if (!currentUser || currentUser.isAnonymous) {
    return (
      <div className={`absolute inset-0 z-50 flex items-center justify-center bg-login-image bg-cover bg-center ${theme}`}>
        <div className="relative z-10 glass-panel w-full max-w-md p-10 rounded-2xl border border-white/10 border-t-4 border-t-gymGold flex flex-col items-center shadow-[0_20px_50px_rgba(0,0,0,0.5)] fade-in bg-[#09090b]/80 backdrop-blur-xl">
          <div className="relative w-36 h-36 mb-6 rounded-full p-1 bg-gradient-to-tr from-[#997A15] via-gymGold to-[#fff2cc] logo-glow">
            <img src="https://i.ibb.co/VW9FPYx1/PHOTO-2026-03-16-20-44-44.jpg" alt="Logo" className="w-full h-full object-cover rounded-full border-[5px] border-[#09090b]" />
          </div>
          <h1 className="text-3xl font-black mb-1 tracking-[0.25em] text-gold-gradient uppercase text-center">Legends Gym</h1>
          <p className="text-gray-400 text-[10px] mb-8 tracking-[0.3em] uppercase font-bold text-center">Pro Management Suite</p>
          
          <form className="w-full space-y-5" onSubmit={authMode === 'login' ? handleLogin : handleRegister}>
            {authMode === 'register' && (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-widest">Full Name</label>
                <input type="text" required className="pc-input w-full" value={regName} onChange={e => setRegName(e.target.value)} />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-widest">Admin Email</label>
              <input type="email" required className="pc-input w-full" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-widest">Passkey</label>
              <input type="password" required className="pc-input w-full" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-gymGold to-yellow-500 text-black font-black py-3.5 rounded-lg uppercase tracking-widest mt-6 text-xs flex justify-center gap-2">
              {loading ? <i className="fas fa-circle-notch fa-spin"></i> : <span>{authMode === 'login' ? 'Secure Login' : 'Register'}</span>}
            </button>
            <div className="text-center mt-4">
              <button type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="text-gray-500 hover:text-gymGold text-[10px] font-bold uppercase tracking-widest transition">
                {authMode === 'login' ? (adminsCount < 3 ? 'New Admin Registration' : '') : 'Back to Login'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const activeCount = members.filter(m => getStatus(m.expiryDate) === 'Active').length;
  const expiringCount = members.filter(m => getStatus(m.expiryDate) === 'Expiring').length;
  const expiredCount = members.filter(m => getStatus(m.expiryDate) === 'Expired').length;

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden ${theme === 'light' ? 'light-theme bg-[#f3f4f6]' : 'bg-[#09090b]'}`}>
      {/* Toast */}
      <div className={`fixed top-8 left-1/2 transform -translate-x-1/2 z-[100] transition-all duration-300 ${toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-32 pointer-events-none'}`}>
        <div className={`glass-panel px-8 py-4 rounded-xl shadow-2xl bg-[#121214] flex items-center gap-4 border-b-4 min-w-[320px] justify-center backdrop-blur-3xl ${toast.type === 'success' ? 'border-gymGold' : 'border-gymRed'}`}>
          <i className={`text-2xl ${toast.type === 'success' ? 'fas fa-check-circle text-gymGold' : 'fas fa-exclamation-triangle text-gymRed'}`}></i>
          <div className="text-left">
            <h4 className="font-bold text-white text-sm uppercase tracking-widest">{toast.title}</h4>
            <p className="text-gray-400 text-xs mt-1 font-medium">{toast.message}</p>
          </div>
        </div>
      </div>

      <div className="flex h-full w-full">
        {/* Sidebar */}
        <aside className="w-64 glass-panel border-r border-[#27272a] flex flex-col z-30 flex-shrink-0 bg-[#09090b]">
          <div className="h-20 flex items-center px-6 border-b border-[#27272a] gap-4">
            <img src="https://i.ibb.co/VW9FPYx1/PHOTO-2026-03-16-20-44-44.jpg" alt="Logo" className="w-10 h-10 rounded border border-gymGold/30 shadow-[0_0_8px_rgba(212,175,55,0.2)]" />
            <div>
              <h2 className="text-gold-gradient font-black text-base tracking-widest leading-tight">LEGENDS</h2>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-0.5">Admin Module</p>
            </div>
          </div>
          <nav className="flex-1 py-6 overflow-y-auto space-y-1">
            <div className="px-6 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Main Menu</div>
            {[
              { id: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
              { id: 'add-member', icon: 'fa-user-plus', label: 'Add Member' },
              { id: 'members-list', icon: 'fa-users', label: 'Member Database' }
            ].map(nav => (
              <button key={nav.id} onClick={() => { setCurrentView(nav.id); if(nav.id !== 'add-member') resetForm(); }} className={`w-full text-left flex items-center px-6 py-3.5 text-sm font-medium transition ${currentView === nav.id ? 'bg-gradient-to-r from-gymGold/10 to-transparent border-l-4 border-gymGold text-gymGold' : 'text-gray-300 hover:text-gymGold hover:bg-white/5 border-l-4 border-transparent'}`}>
                <i className={`fas ${nav.icon} w-6 text-center mr-3`}></i> {nav.label}
              </button>
            ))}
            <div className="px-6 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 mt-8">System</div>
            {[
              { id: 'reports', icon: 'fa-file-pdf', label: 'Export & Reports' },
              { id: 'settings', icon: 'fa-cog', label: 'Settings' },
              { id: 'about', icon: 'fa-info-circle', label: 'About' }
            ].map(nav => (
              <button key={nav.id} onClick={() => setCurrentView(nav.id)} className={`w-full text-left flex items-center px-6 py-3.5 text-sm font-medium transition ${currentView === nav.id ? 'bg-gradient-to-r from-gymGold/10 to-transparent border-l-4 border-gymGold text-gymGold' : 'text-gray-300 hover:text-gymGold hover:bg-white/5 border-l-4 border-transparent'}`}>
                <i className={`fas ${nav.icon} w-6 text-center mr-3`}></i> {nav.label}
              </button>
            ))}
          </nav>
          <div className="p-4 border-t border-[#27272a]">
            <button onClick={() => signOut(auth)} className="w-full flex items-center justify-center py-3 px-4 rounded-lg bg-[#121214] hover:bg-gymRed/10 text-gray-400 hover:text-gymRed transition-colors border border-[#27272a] text-xs font-bold uppercase tracking-widest">
              <i className="fas fa-sign-out-alt mr-2"></i> Logout
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col relative bg-[#09090b] z-20">
          <header className="h-20 glass-panel border-b border-[#27272a] flex items-center justify-between px-8 z-10 bg-[#09090b]/90">
            <h2 className="text-xl font-black text-white tracking-widest uppercase">{currentView.replace('-', ' ')}</h2>
            <div className="flex items-center gap-6">
              <div className="text-right border-r border-[#27272a] pr-6">
                <div className="text-[10px] font-bold text-white tracking-widest uppercase">{time.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div>
                <div className="text-[11px] text-gymGold font-mono mt-0.5 font-bold">{time.toLocaleTimeString()}</div>
              </div>
              <div className="w-10 h-10 rounded-full border-2 border-gymGold/50 flex items-center justify-center bg-[#121214] shadow-[0_0_10px_rgba(212,175,55,0.15)]">
                <i className="fas fa-cloud text-gymGold text-sm"></i>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-8 relative scroll-smooth">
            
            {/* DASHBOARD */}
            {currentView === 'dashboard' && (
              <section className="fade-in block space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="glass-panel p-6 rounded-xl border border-[#27272a] border-l-4 border-l-blue-500 bg-[#121214] relative group">
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2 group-hover:text-blue-400 transition">Total Members</p>
                    <h3 className="text-4xl font-black text-white">{members.length}</h3>
                    <i className="fas fa-users absolute right-4 bottom-4 text-6xl text-blue-500 opacity-5 group-hover:scale-110 transition transform"></i>
                  </div>
                  <div className="glass-panel p-6 rounded-xl border border-[#27272a] border-l-4 border-l-gymGreen bg-[#121214] relative group">
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2 group-hover:text-gymGreen transition">Active Members</p>
                    <h3 className="text-4xl font-black text-white">{activeCount}</h3>
                    <i className="fas fa-check-circle absolute right-4 bottom-4 text-6xl text-gymGreen opacity-5 group-hover:scale-110 transition transform"></i>
                  </div>
                  <div className="glass-panel p-6 rounded-xl border border-[#27272a] border-l-4 border-l-gymOrange bg-[#121214] relative group">
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2 group-hover:text-gymOrange transition">Expiring Soon</p>
                    <h3 className="text-4xl font-black text-white">{expiringCount}</h3>
                    <i className="fas fa-exclamation-triangle absolute right-4 bottom-4 text-6xl text-gymOrange opacity-5 group-hover:scale-110 transition transform"></i>
                  </div>
                  <div className="glass-panel p-6 rounded-xl border border-[#27272a] border-l-4 border-l-gymRed bg-[#121214] relative group">
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-2 group-hover:text-gymRed transition">Expired Plans</p>
                    <h3 className="text-4xl font-black text-white">{expiredCount}</h3>
                    <i className="fas fa-times-circle absolute right-4 bottom-4 text-6xl text-gymRed opacity-5 group-hover:scale-110 transition transform"></i>
                  </div>
                </div>
              </section>
            )}

            {/* ADD / EDIT MEMBER */}
            {currentView === 'add-member' && (
              <section className="fade-in">
                <div className="glass-panel p-8 rounded-xl max-w-5xl mx-auto bg-[#121214] border border-[#27272a] shadow-2xl">
                  <div className="flex items-center justify-between border-b border-[#27272a] pb-5 mb-8">
                    <h3 className="text-lg font-black text-white flex items-center tracking-wide uppercase">
                      <div className="w-10 h-10 bg-gymGold/10 text-gymGold rounded-lg flex items-center justify-center mr-4 border border-gymGold/20">
                        <i className={editingId ? "fas fa-user-edit" : "fas fa-user-plus"}></i>
                      </div>
                      {editingId ? 'Edit Member Profile' : 'Member Registration'}
                    </h3>
                    <span className="text-xs font-mono bg-[#09090b] border border-[#27272a] text-gray-400 px-3 py-1.5 rounded uppercase tracking-widest">
                      ID: {editingId ? editingId : 'Auto-Generated'}
                    </span>
                  </div>
                  
                  <form onSubmit={handleMemberSubmit}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                      {/* Personal Info */}
                      <div className="space-y-5">
                        <h4 className="text-gymGold uppercase tracking-widest text-xs font-bold border-l-2 border-gymGold pl-3">Personal Details</h4>
                        <div>
                          <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Full Name <span className="text-gymRed">*</span></label>
                          <input type="text" required className="pc-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Mobile <span className="text-gymRed">*</span></label>
                            <input type="tel" required pattern="[0-9]{10}" className="pc-input" value={formData.mobile} onChange={e => setFormData({...formData, mobile: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">DOB</label>
                            <input type="date" className="pc-input" value={formData.dob} onChange={e => setFormData({...formData, dob: e.target.value})} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Gender</label>
                            <select className="pc-input" value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})}>
                              <option>Male</option><option>Female</option><option>Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Address</label>
                            <input type="text" className="pc-input" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
                          </div>
                        </div>
                      </div>

                      {/* Plan Info */}
                      <div className="space-y-5">
                        <h4 className="text-gymGold uppercase tracking-widest text-xs font-bold border-l-2 border-gymGold pl-3">Membership Plan</h4>
                        <div className="grid grid-cols-2 gap-5">
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Plan <span className="text-gymRed">*</span></label>
                            <select required className="pc-input" value={formData.plan} onChange={e => {
                              const p = e.target.value;
                              const amtMap = {'1 Month': 1000, '3 Months': 2500, '6 Months': 4500, '1 Year': 8000};
                              setFormData({...formData, plan: p, amount: amtMap[p] || ''});
                            }}>
                              <option value="" disabled>Select Plan</option>
                              <option>1 Month</option><option>3 Months</option><option>6 Months</option><option>1 Year</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Join Date <span className="text-gymRed">*</span></label>
                            <input type="date" required className="pc-input" value={formData.joinDate} onChange={e => setFormData({...formData, joinDate: e.target.value})} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Amount (₹) <span className="text-gymRed">*</span></label>
                            <input type="number" required className="pc-input" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase">Pay Mode</label>
                            <select className="pc-input" value={formData.paymode} onChange={e => setFormData({...formData, paymode: e.target.value})}>
                              <option>Cash</option><option>UPI</option><option>Card</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-8 pt-6 border-t border-[#27272a] flex justify-end gap-4">
                      <button type="button" onClick={resetForm} className="px-6 py-2.5 rounded-lg border border-[#27272a] text-gray-300 hover:bg-[#18181b] transition font-bold text-xs uppercase tracking-wide">Clear</button>
                      <button type="submit" disabled={loading} className="px-8 py-2.5 rounded-lg bg-gymGold text-black font-black hover:bg-yellow-500 transition shadow-[0_0_15px_rgba(212,175,55,0.2)] text-xs uppercase tracking-widest flex items-center gap-2">
                        {loading ? <i className="fas fa-circle-notch fa-spin"></i> : <><i className="fas fa-save"></i> Save Member</>}
                      </button>
                    </div>
                  </form>
                </div>
              </section>
            )}

            {/* MEMBERS LIST */}
            {currentView === 'members-list' && (
              <section className="fade-in h-full flex flex-col">
                <div className="glass-panel p-4 rounded-t-xl border border-[#27272a] border-b-0 bg-[#121214] flex flex-wrap gap-4 items-center justify-between z-20">
                  <div className="relative w-full md:w-72">
                    <i className="fas fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500 text-xs z-10"></i>
                    <input type="text" placeholder="Search Name, ID, Phone..." className="pc-input pl-10 py-2 text-xs relative w-full" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} />
                  </div>
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-widest px-4 py-2 bg-[#09090b] rounded-lg border border-[#27272a]">
                    Total Records: <span className="text-gymGold font-mono ml-2 text-sm">{members.length}</span>
                  </div>
                </div>
                <div className="glass-panel rounded-b-xl flex-1 border border-[#27272a] bg-[#09090b] relative flex flex-col overflow-hidden z-10 shadow-xl">
                  <div className="overflow-auto flex-1 w-full h-full relative">
                    <table className="w-full text-left border-collapse data-table text-xs">
                      <thead>
                        <tr>
                          <th className="p-4 font-bold text-gray-400 uppercase tracking-widest text-[10px] border-r border-[#27272a] sticky top-0 bg-[#121214]">ID</th>
                          <th className="p-4 font-bold text-gray-400 uppercase tracking-widest text-[10px] border-r border-[#27272a] sticky top-0 bg-[#121214]">Name</th>
                          <th className="p-4 font-bold text-gray-400 uppercase tracking-widest text-[10px] border-r border-[#27272a] sticky top-0 bg-[#121214]">Contact</th>
                          <th className="p-4 font-bold text-gray-400 uppercase tracking-widest text-[10px] border-r border-[#27272a] sticky top-0 bg-[#121214]">Plan</th>
                          <th className="p-4 font-bold text-gray-400 uppercase tracking-widest text-[10px] border-r border-[#27272a] sticky top-0 bg-[#121214]">Expiry</th>
                          <th className="p-4 font-bold text-gray-400 uppercase tracking-widest text-[10px] border-r border-[#27272a] text-center sticky top-0 bg-[#121214]">Status</th>
                          <th className="p-4 font-bold text-gray-400 uppercase tracking-widest text-[10px] text-center sticky top-0 bg-[#121214]">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.filter(m => m.name.toLowerCase().includes(globalSearch.toLowerCase()) || m.id.includes(globalSearch) || m.mobile.includes(globalSearch)).map(m => (
                          <tr key={m.id} className="hover:bg-white/5 border-b border-[#18181b]">
                            <td className="p-4 text-gymGold font-mono text-[11px] border-r border-[#27272a]">{m.id}</td>
                            <td className="p-4 font-bold text-gray-200 uppercase tracking-wide text-[11px] border-r border-[#27272a]">{m.name}</td>
                            <td className="p-4 text-gray-400 font-mono text-[11px] border-r border-[#27272a]">{m.mobile}</td>
                            <td className="p-4 text-blue-400 font-bold uppercase tracking-wider text-[11px] border-r border-[#27272a]">{m.plan}</td>
                            <td className="p-4 text-gray-400 text-[11px] font-mono border-r border-[#27272a]">{formatDate(m.expiryDate)}</td>
                            <td className="p-4 text-center border-r border-[#27272a]">
                              <span className={`px-2.5 py-1 rounded border text-[10px] font-bold tracking-widest uppercase ${getStatus(m.expiryDate) === 'Active' ? 'bg-gymGreen/10 text-gymGreen border-gymGreen/30' : getStatus(m.expiryDate) === 'Expiring' ? 'bg-gymOrange/10 text-gymOrange border-gymOrange/30' : 'bg-gymRed/10 text-gymRed border-gymRed/30'}`}>
                                {getStatus(m.expiryDate)}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              <button onClick={() => { setViewMember(m); setActiveModal('profile'); }} className="px-4 py-2 rounded-lg bg-[#18181b] border border-[#27272a] hover:bg-gymGold hover:border-gymGold text-gray-300 hover:text-black transition flex items-center justify-center mx-auto text-[10px] font-black uppercase tracking-widest shadow-sm">
                                View Profile
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* REPORTS */}
            {currentView === 'reports' && (
              <section className="fade-in">
                <div className="glass-panel p-10 rounded-xl max-w-2xl mx-auto bg-[#121214] border border-[#27272a] mt-4">
                  <h3 className="text-lg font-black text-white border-b border-[#27272a] pb-5 mb-8 flex items-center tracking-widest uppercase justify-center">
                    <i className="fas fa-print text-gymRed mr-3"></i> Download Reports
                  </h3>
                  <div className="bg-[#09090b] border border-[#27272a] p-8 rounded-xl text-center shadow-inner">
                    <div className="w-20 h-20 mx-auto bg-gymRed/10 border border-gymRed/20 rounded-full flex items-center justify-center mb-6">
                      <i className="fas fa-file-pdf text-3xl text-gymRed"></i>
                    </div>
                    <h4 className="font-bold text-base text-white mb-3 uppercase tracking-widest">Master Database PDF</h4>
                    <p className="text-xs text-gray-400 mb-8 leading-relaxed max-w-sm mx-auto">Download a clean, printable white-background PDF document containing all registered member data.</p>
                    <button onClick={exportPDF} className="w-full max-w-[250px] mx-auto block bg-gymRed hover:bg-red-700 text-white py-3 rounded-lg font-black transition text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                      <i className="fas fa-download mr-2"></i> Download Database
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* SETTINGS */}
            {currentView === 'settings' && (
              <section className="fade-in">
                <div className="glass-panel p-10 rounded-xl max-w-3xl mx-auto bg-[#121214] border border-[#27272a] mt-4">
                  <h3 className="text-lg font-black text-white border-b border-[#27272a] pb-5 mb-8 flex items-center tracking-widest uppercase">
                    <i className="fas fa-cogs text-gray-400 mr-4"></i> System Configuration
                  </h3>
                  <div className="space-y-6">
                    <div className="bg-[#09090b] p-6 rounded-lg border border-[#27272a] shadow-inner flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex items-center gap-5">
                        <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
                          <i className="fas fa-palette text-xl"></i>
                        </div>
                        <div>
                          <h4 className="text-white font-bold tracking-wide text-sm uppercase">Interface Theme</h4>
                          <p className="text-xs text-gray-500 mt-1 tracking-wide">Switch between Light and Dark mode</p>
                        </div>
                      </div>
                      <select className="pc-input w-full md:w-56 text-xs font-bold uppercase tracking-widest" value={theme} onChange={e => toggleTheme(e.target.value)}>
                        <option value="dark">Dark Mode (Default)</option>
                        <option value="light">Light Mode</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ABOUT */}
            {currentView === 'about' && (
              <section className="fade-in">
                <div className="glass-panel p-12 rounded-xl max-w-3xl mx-auto bg-[#121214] border border-[#27272a] mt-4 text-center shadow-2xl">
                  <div className="w-32 h-32 mx-auto bg-gradient-to-tr from-[#997A15] via-gymGold to-[#fff2cc] rounded-full p-1 logo-glow mb-6">
                    <img src="https://i.ibb.co/VW9FPYx1/PHOTO-2026-03-16-20-44-44.jpg" alt="Legends Gym" className="w-full h-full object-cover rounded-full border-[4px] border-[#09090b]" />
                  </div>
                  <h2 className="text-3xl font-black text-gold-gradient uppercase tracking-widest mb-2">Legends Gym</h2>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-8">Pro Management System</p>
                  <div className="bg-[#09090b] border border-[#27272a] p-8 rounded-xl mb-10 shadow-inner">
                    <p className="text-gray-400 text-sm leading-relaxed mb-8">
                      A state-of-the-art cloud management suite designed exclusively for Legends Gym. Built to handle dynamic roster management, automated billing cycles, secure digital records, and streamlined administrative control.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left border-t border-[#27272a] pt-8">
                      <div className="bg-[#121214] p-4 rounded border border-[#27272a]">
                        <p className="text-[10px] text-gymGold font-bold uppercase tracking-widest mb-3 border-b border-[#27272a] pb-2"><i className="fas fa-crown mr-1"></i> Gym Owners</p>
                        <p className="text-xs text-gray-200 font-semibold mb-1">1. Dinesh Nayak</p>
                        <p className="text-xs text-gray-200 font-semibold">2. Jaikesh Nayak</p>
                      </div>
                      <div className="bg-[#121214] p-4 rounded border border-[#27272a]">
                        <p className="text-[10px] text-gymGold font-bold uppercase tracking-widest mb-3 border-b border-[#27272a] pb-2"><i className="fas fa-headset mr-1"></i> Contacts</p>
                        <p className="text-xs text-gray-200 font-mono mb-1"><i className="fas fa-phone-alt text-[10px] text-gray-500 mr-2"></i>+91 8780001530</p>
                        <p className="text-xs text-gray-200 font-mono"><i className="fas fa-phone-alt text-[10px] text-gray-500 mr-2"></i>+91 8160632256</p>
                      </div>
                      <div className="bg-[#121214] p-4 rounded border border-[#27272a]">
                        <p className="text-[10px] text-gymGold font-bold uppercase tracking-widest mb-3 border-b border-[#27272a] pb-2"><i className="fas fa-map-marker-alt mr-1"></i> Location</p>
                        <p className="text-xs text-gray-200 leading-relaxed">3rd Floor, Rajmahal Mall, Dindoli</p>
                      </div>
                    </div>
                  </div>
                  <div className="inline-block bg-[#09090b] border border-[#27272a] px-8 py-4 rounded-full shadow-md">
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">
                      Developed by :- <span className="text-gymGold font-black ml-2 tracking-widest text-sm">Arinfotech</span>
                    </p>
                  </div>
                </div>
              </section>
            )}

          </div>
        </main>
      </div>

      {/* MODALS */}
      {activeModal === 'profile' && viewMember && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-4xl rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] border border-[#27272a] flex flex-col max-h-[90vh] bg-[#121214] overflow-hidden">
            <div className="relative p-6 border-b border-[#27272a] bg-gradient-to-r from-[#09090b] to-[#121214] z-10">
              <div className="flex justify-between items-start relative z-10">
                <div className="flex items-center gap-5">
                  <div className="w-16 h-16 rounded-full bg-[#18181b] border-2 border-gymGold/50 flex items-center justify-center text-2xl text-gymGold font-black shadow-[0_0_15px_rgba(212,175,55,0.2)]">
                    {viewMember.name.substring(0,2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-white m-0 tracking-wide uppercase">{viewMember.name}</h2>
                    <span className="text-xs font-mono text-gymGold bg-gymGold/10 px-2.5 py-0.5 rounded border border-gymGold/20 uppercase tracking-widest mt-1 inline-block font-bold">{viewMember.id}</span>
                  </div>
                </div>
                <button onClick={() => setActiveModal(null)} className="w-10 h-10 rounded-lg bg-[#27272a] hover:bg-gymRed text-gray-400 hover:text-white flex items-center justify-center transition-colors text-lg shadow-sm">
                  <i className="fas fa-times"></i>
                </button>
              </div>
            </div>
            <div className="p-8 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="md:col-span-2 space-y-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-[#09090b] p-4 rounded-lg border border-[#27272a]">
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center"><i className="fas fa-shield-alt text-gray-600 mr-2 text-xs"></i> Account Status</p>
                    <span className={`border px-3 py-1 rounded-md text-[10px] font-bold tracking-widest uppercase inline-block ${getStatus(viewMember.expiryDate) === 'Active' ? 'text-gymGreen border-gymGreen/50 bg-gymGreen/10' : getStatus(viewMember.expiryDate) === 'Expiring' ? 'text-gymOrange border-gymOrange/50 bg-gymOrange/10' : 'text-gymRed border-gymRed/50 bg-gymRed/10'}`}>{getStatus(viewMember.expiryDate)}</span>
                  </div>
                  <div className="bg-[#09090b] p-4 rounded-lg border border-[#27272a]">
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center"><i className="fas fa-phone-alt text-gray-600 mr-2 text-xs"></i> Contact</p>
                    <p className="text-white font-mono text-sm font-semibold">{viewMember.mobile}</p>
                  </div>
                  <div className="bg-[#09090b] p-4 rounded-lg border border-[#27272a]">
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center"><i className="fas fa-dumbbell text-gray-600 mr-2 text-xs"></i> Plan</p>
                    <p className="text-blue-400 font-bold text-sm tracking-wide uppercase">{viewMember.plan}</p>
                  </div>
                  <div className="bg-[#09090b] p-4 rounded-lg border border-[#27272a] border-l-4 border-l-gymOrange">
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center"><i className="fas fa-hourglass-end text-gymOrange mr-2 text-xs"></i> Expiry Date</p>
                    <p className="text-white font-bold text-sm tracking-wide">{formatDate(viewMember.expiryDate)}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 bg-[#09090b] p-5 rounded-lg border border-[#27272a]">
                <h4 className="text-gymGold text-xs font-bold uppercase tracking-widest mb-4 border-b border-[#27272a] pb-2">
                  <i className="fas fa-bolt mr-2"></i> Quick Actions
                </h4>
                <button onClick={() => window.open(`https://api.whatsapp.com/send?phone=91${viewMember.mobile}&text=${encodeURIComponent(`Dear ${viewMember.name},\nYour plan at Legends Gym expires on ${formatDate(viewMember.expiryDate)}.\n\nBest, Legends Gym Team`)}`, '_blank')} className="w-full bg-[#25D366]/10 border border-[#25D366]/30 hover:bg-[#25D366] text-[#25D366] hover:text-white py-2.5 rounded-lg font-bold transition flex items-center justify-center gap-2 text-xs uppercase tracking-wide">
                  <i className="fab fa-whatsapp text-base"></i> Send WhatsApp
                </button>
                <button onClick={generateBill} className="w-full bg-[#3b82f6]/10 border border-[#3b82f6]/30 hover:bg-[#3b82f6] text-[#3b82f6] hover:text-white py-2.5 rounded-lg font-bold transition flex items-center justify-center gap-2 text-xs uppercase tracking-wide">
                  <i className="fas fa-file-invoice-dollar text-base"></i> Generate Receipt
                </button>
                <button onClick={() => { setActiveModal('renew'); setFormData({...formData, plan: viewMember.plan}); }} className="w-full bg-gymGold/10 border border-gymGold/30 hover:bg-gymGold text-gymGold hover:text-black py-2.5 rounded-lg font-bold transition flex items-center justify-center gap-2 text-xs uppercase tracking-wide mt-2">
                  <i className="fas fa-sync-alt text-base"></i> Renew Plan
                </button>
                <div className="h-px w-full bg-[#27272a] my-4"></div>
                <button onClick={() => editMember(viewMember)} className="w-full bg-blue-500/10 hover:bg-blue-500 border border-blue-500/30 text-blue-400 hover:text-white py-2.5 rounded-lg font-bold transition flex items-center justify-center gap-2 text-xs uppercase tracking-wide mb-2">
                  <i className="fas fa-edit"></i> Edit Profile
                </button>
                <button onClick={deleteMember} className="w-full bg-transparent hover:bg-gymRed border border-gymRed/30 text-gray-400 hover:text-white py-2.5 rounded-lg font-bold transition flex items-center justify-center gap-2 text-xs uppercase tracking-wide">
                  <i className="fas fa-trash"></i> Delete Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'renew' && viewMember && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md rounded-xl p-8 shadow-2xl border border-[#27272a] border-t-4 border-t-gymGold bg-[#121214]">
            <div className="flex items-center gap-3 mb-2">
              <i className="fas fa-sync-alt text-gymGold text-xl"></i>
              <h3 className="text-lg font-black text-white tracking-widest uppercase">Renew Membership</h3>
            </div>
            <p className="text-xs text-gray-500 mb-6 pb-4 border-b border-[#27272a]">Member: <span className="font-bold text-gray-200 uppercase tracking-wide">{viewMember.name}</span></p>
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Select New Plan</label>
                <select className="pc-input bg-[#09090b]" value={formData.plan} onChange={e => {
                  const p = e.target.value; const amtMap = {'1 Month': 1000, '3 Months': 2500, '6 Months': 4500, '1 Year': 8000};
                  setFormData({...formData, plan: p, amount: amtMap[p] || ''});
                }}>
                  <option>1 Month</option><option>3 Months</option><option>6 Months</option><option>1 Year</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Amount Paid (₹)</label>
                <input type="number" className="pc-input bg-[#09090b] font-mono" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">New Joining Date</label>
                <input type="date" className="pc-input bg-[#09090b]" value={formData.joinDate} onChange={e => setFormData({...formData, joinDate: e.target.value})} />
              </div>
            </div>
            <div className="mt-8 flex gap-4">
              <button onClick={() => setActiveModal('profile')} className="flex-1 py-3 border border-[#27272a] rounded-lg text-gray-400 hover:bg-[#18181b] font-bold text-xs uppercase tracking-widest transition">Cancel</button>
              <button onClick={processRenewal} disabled={loading} className="flex-1 py-3 bg-gymGold text-black font-black rounded-lg hover:brightness-110 shadow-[0_0_15px_rgba(212,175,55,0.2)] text-xs uppercase tracking-widest transition flex justify-center items-center gap-2">
                {loading ? <i className="fas fa-circle-notch fa-spin"></i> : <span>Authorize</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
