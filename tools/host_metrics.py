"""Measure host CPU and memory where the OS exposes counters."""
import ctypes
import os
import sys
import threading
_lock=threading.Lock()
_prev=None

def metrics():
    global _prev
    ram=None;cpu=None;load=None
    if sys.platform.startswith('linux'):
        from pathlib import Path
        mem={l.split(':')[0]:int(l.split()[1]) for l in Path('/proc/meminfo').read_text().splitlines() if len(l.split())>=3}
        ram=100*(1-mem['MemAvailable']/mem['MemTotal'])
        j=[int(v) for v in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
        total=sum(j);idle=j[3]+j[4];load=os.getloadavg()[0]
    elif os.name=='nt':
        class Memory(ctypes.Structure):
            _fields_=[('length',ctypes.c_uint32),('load',ctypes.c_uint32)]+[('count'+str(i),ctypes.c_uint64) for i in range(7)]
        m=Memory();m.length=ctypes.sizeof(m)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):ram=m.load
        i,k,u=ctypes.c_uint64(),ctypes.c_uint64(),ctypes.c_uint64()
        if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(i),ctypes.byref(k),ctypes.byref(u)):return None,ram,None
        total=k.value+u.value;idle=i.value
    else:return None,None,None
    with _lock:
        if _prev and total>_prev[0]:
            cpu=round(max(0,min(100,100*(1-(idle-_prev[1])/(total-_prev[0])))),1)
        _prev=(total,idle)
    return cpu,round(ram,1) if ram is not None else None,load
