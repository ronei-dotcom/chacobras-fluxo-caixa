import {firebaseConfig} from './firebase-config.js';
import {canonical,OWNER_EMAIL} from './model.js';
let api;
export async function connect() {
 if(api) return api;
 const v='12.19.0',base=`https://www.gstatic.com/firebasejs/${v}`;
 const [a,u,f]=await Promise.all([import(`${base}/firebase-app.js`),import(`${base}/firebase-auth.js`),import(`${base}/firebase-firestore.js`)]);
 const app=a.initializeApp(firebaseConfig),auth=u.getAuth(app),db=f.getFirestore(app);
 const main=f.doc(db,'chacobrasFlow','main');
 api={
  observeAuth:callback=>u.onAuthStateChanged(auth,callback),
  login:()=>{const provider=new u.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});return u.signInWithPopup(auth,provider);},
  logout:()=>u.signOut(auth),
  async role(user){
    if(!user?.emailVerified) return null;
    if(user.email===OWNER_EMAIL) return 'owner';
    const member=await f.getDoc(f.doc(db,'chacobrasMembers',user.email));
    return member.exists()?member.data().role:null;
  },
  observe: (next,error)=>f.onSnapshot(main,{includeMetadataChanges:true},snap=>next(snap.exists()?{...snap.data(),cached:snap.metadata.fromCache}:null),error),
  async save(state,baseRevision,user){
    const payload=JSON.stringify(canonical(state));
    if(payload.length>250000)throw new Error('O arquivo ultrapassa o limite desta versão.');
    const history=f.doc(f.collection(db,'chacobrasFlow','main','revisions'));
    return f.runTransaction(db,async tx=>{
      const old=await tx.get(main),revision=old.exists()?old.data().revision:0;
      if(revision!==baseRevision)throw new Error('CONFLICT');
      const body={payload,revision:revision+1,updatedBy:user.email,updatedAt:f.serverTimestamp(),lastChangeId:history.id};
      tx.set(main,body);tx.set(history,body);
      return revision+1;
    });
  },
  async history(){return (await f.getDocs(f.query(f.collection(db,'chacobrasFlow','main','revisions'),f.orderBy('revision','desc'),f.limit(20)))).docs.map(d=>({id:d.id,...d.data()}));},
  async members(){return (await f.getDocs(f.collection(db,'chacobrasMembers'))).docs.map(d=>({email:d.id,...d.data()}));},
  setMember:(email,role)=>f.setDoc(f.doc(db,'chacobrasMembers',email),{role}),
  // Revocation is an update, preserving the membership record.
  revoke:email=>f.setDoc(f.doc(db,'chacobrasMembers',email),{role:'disabled'})
 };
 return api;
}
