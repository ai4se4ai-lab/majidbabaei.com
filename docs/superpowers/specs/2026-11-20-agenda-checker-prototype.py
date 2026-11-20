# Reference prototype for tools/agenda-model.mjs: explicit-state check of V1-V5 on the agenda statechart and its mutants.
# Run: python3 2026-11-20-agenda-checker-prototype.py
K=2
def model(drop=(), retarget=None, bound=True):
    T=[("bind","human","ai","delegate",lambda env,t: env["cm"]),
       ("account","ai","human","report",lambda env,t: env["holds"]),
       ("withdraw","ai","quarantine","report",lambda env,t: not env["holds"]),
       ("revalidate","quarantine","ai",None,lambda env,t: env["clean"] and (t<K if bound else True)),
       ("escalate","quarantine","human",None,"else")]
    T=[x for x in T if x[0] not in drop]
    if retarget: T=[(i,f,retarget[1] if i==retarget[0] else to,tr,g) for (i,f,to,tr,g) in T]
    return T
def succ(T,node):
    s,t,_=node; out=set()
    envs=[dict(cm=a,holds=b,clean=c) for a in (0,1) for b in (0,1) for c in (0,1)]
    for env in envs:
        en=[x for x in T if x[1]==s and x[4]!="else" and x[4](env,t)]
        if not en: en=[x for x in T if x[1]==s and x[4]=="else"]
        if not en and s=="human": out.add(node); continue   # event discarded: stay
        for (i,f,to,tr,g) in en:
            nt=t+1 if i=="withdraw" else t
            nt=min(nt,K+3)
            if to=="human": nt=0
            out.add((to,nt,i))
    return out
def reach(T):
    init=("human",0,None); seen={init}; st=[init]; E={}
    while st:
        n=st.pop(); E[n]=succ(T,n)
        for m in E[n]:
            if m not in seen: seen.add(m); st.append(m)
    return seen,E
def EF(E,nodes,pred):
    good={n for n in nodes if pred(n)}; ch=True
    while ch:
        ch=False
        for n in nodes:
            if n not in good and E[n]&good: good.add(n); ch=True
    return good
def AF(E,nodes,pred):
    good={n for n in nodes if pred(n)}; ch=True
    while ch:
        ch=False
        for n in nodes:
            if n not in good and E[n] and E[n]<=good: good.add(n); ch=True
    return good
def check(T):
    N,E=reach(T); r={}
    r["V1 AG EF human"]=all(n in EF(E,N,lambda m:m[0]=="human") for n in N)
    r["V2 withdraw->quarantine"]=all(n[0]=="quarantine" for n in N if n[2]=="withdraw") and any(n[2]=="withdraw" for n in N)
    r["V3 quarantine left"]=all(any(m[0]!="quarantine" for m in E[n]) for n in N if n[0]=="quarantine")
    af=AF(E,N,lambda m:m[0]=="human")
    r["V4 AG(q->AF human)"]=all(n in af for n in N if n[0]=="quarantine")
    r["V5 reach ai,q"]={n[0] for n in N}>={"ai","quarantine"} and all(n in EF(E,N,lambda m:m[0]=="ai") for n in N)
    return r,len(N)
for name,T in [("model",model()),("mut: drop revalidate+escalate",model(drop=("revalidate","escalate"))),
               ("mut: withdraw->human",model(retarget=("withdraw","human"))),
               ("mut: no retry bound",model(bound=False)),("mut: drop withdraw",model(drop=("withdraw",)))]:
    r,n=check(T); print(f"{name:32s} nodes={n:2d} ", {k.split()[0]:v for k,v in r.items()})
