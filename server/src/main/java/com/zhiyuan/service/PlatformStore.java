package com.zhiyuan.service;

import com.zhiyuan.domain.Models;
import com.zhiyuan.fulfilment.FulfilmentConflictException;
import com.zhiyuan.fulfilment.FulfilmentService;
import com.zhiyuan.fulfilment.FulfilmentStore;
import com.zhiyuan.fulfilment.InMemoryFulfilmentStore;
import com.zhiyuan.fulfilment.SqlFulfilmentStore;
import com.zhiyuan.persistence.PlatformDatabase;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;

@Service
public class PlatformStore {
    public record OrderLine(long goodsId, int count) {}
    public record AuditPage(List<Models.AuditLog> items, int page, int size, long total, int totalPages) {}
    private static final ZoneOffset OFFSET = ZoneOffset.ofHours(8);
    private final Map<Long, Models.Uav> uavs = new ConcurrentHashMap<>();
    private final Map<Long, Models.Alert> alerts = new ConcurrentHashMap<>();
    private final Map<Long, Models.FlightLog> flightLogs = new ConcurrentHashMap<>();
    private final Map<String, Models.ControlCommand> commands = new ConcurrentHashMap<>();
    private final Map<Long, Models.User> users = new ConcurrentHashMap<>();
    private final Map<Long, Models.Goods> goods = new ConcurrentHashMap<>();
    private final Map<Long, Models.Order> orders = new ConcurrentHashMap<>();
    private final Map<Long, Models.Task> tasks = new ConcurrentHashMap<>();
    private final Map<Long, Models.Pod> pods = new ConcurrentHashMap<>();
    private final Map<Long, Models.Binding> bindings = new ConcurrentHashMap<>();
    private final Map<String, Models.AuditLog> auditLogs = new ConcurrentHashMap<>();
    private final AtomicLong userIds = new AtomicLong(3);
    private final AtomicLong addressIds = new AtomicLong(2);
    private final AtomicLong goodsIds = new AtomicLong(4);
    private final AtomicLong taskIds = new AtomicLong(2);
    private final AtomicLong bindingIds = new AtomicLong(2);
    private PlatformDatabase database;
    private TransactionTemplate transactions;

    /**
     * Order, inventory and task rules. Both data modes go through this — the reservation
     * lifecycle is identical whether the rows live in MySQL or in this process, which is
     * what lets one set of contract tests cover both (ADR 0001).
     */
    private FulfilmentService fulfilment;

    /** Non-null only in simulator mode, where it is the source of truth for fulfilment. */
    private InMemoryFulfilmentStore memoryFulfilment;

    public PlatformStore() {
        seedMemory();
    }

    @Autowired
    public PlatformStore(PlatformDatabase database, PlatformTransactionManager transactionManager) {
        this.database = database;
        this.transactions = new TransactionTemplate(transactionManager);
        this.fulfilment = new FulfilmentService(new SqlFulfilmentStore(database.jdbc(), transactionManager));
        reload();
    }

    /** Exposed so tests can drive the same rules the API does. */
    public FulfilmentService fulfilment() {
        return fulfilment;
    }

    private void seedMemory() {
        OffsetDateTime now = now();
        putUav(1,"UAV-01","巡检一号","RFID-0001","DJI Mavic 3","陈屿","ONLINE",78,true,"南京",30,5.2,32.06,118.78,now);
        putUav(2,"UAV-02","配送二号","RFID-0002","DJI Air 2S","林潇","FLYING",42,false,"苏州",82,12.4,31.30,120.62,now);
        putUav(3,"UAV-03","应急三号","RFID-0003","Autel EVO II","陈屿","CHARGING",15,true,"上海",0,0,31.23,121.47,now);
        putUav(4,"UAV-04","巡检四号","RFID-0004","DJI Mini 4 Pro","周衡","OFFLINE",0,false,"杭州",0,0,30.27,120.15,now.minusHours(13));
        putUav(5,"UAV-05","配送五号","RFID-0005","DJI Matrice 30","林潇","ONLINE",63,false,"无锡",12,2.4,31.49,120.31,now);
        putUav(6,"UAV-06","备勤六号","RFID-0006","Autel Alpha","周衡","ONLINE",91,false,"南京",0,0,32.07,118.80,now);
        alerts.put(1L,new Models.Alert(1,2L,null,"UAV-02 电量低于 45%","HIGH",now.minusMinutes(3),false,"OPEN",null,null,null,null));
        alerts.put(2L,new Models.Alert(2,5L,null,"UAV-05 信号弱","MID",now.minusMinutes(37),false,"OPEN",null,null,null,null));
        alerts.put(3L,new Models.Alert(3,null,3L,"3 号休眠仓舱门异常","LOW",now.minusHours(16),false,"OPEN",null,null,null,null));
        flightLogs.put(1L,new Models.FlightLog(1,2,"任务起飞","订单 ZY-20260812-003",31.296,120.611,now.minusMinutes(21)));
        flightLogs.put(2L,new Models.FlightLog(2,1,"遥测同步","高度 30m，速度 5.2m/s",32.052,118.765,now.minusMinutes(23)));
        flightLogs.put(3L,new Models.FlightLog(3,3,"进入充电","休眠仓 POD-03",31.231,121.472,now.minusMinutes(28)));
        auditLogs.put("F-1",new Models.AuditLog("F-1","FLIGHT",2L,"任务起飞","订单 ZY-20260812-003","RECORDED","UAV",null,null,now.minusMinutes(21)));
        auditLogs.put("F-2",new Models.AuditLog("F-2","FLIGHT",1L,"遥测同步","高度 30m，速度 5.2m/s","RECORDED","UAV",null,null,now.minusMinutes(23)));
        auditLogs.put("F-3",new Models.AuditLog("F-3","FLIGHT",3L,"进入充电","休眠仓 POD-03","RECORDED","UAV",null,null,now.minusMinutes(28)));
        auditLogs.put("C-seed-voice",new Models.AuditLog("C-seed-voice","VOICE",1L,"RETURN_HOME","无人机一号返航","ACKNOWLEDGED","VOICE",1L,"陈屿",now.minusMinutes(12)));
        users.put(1L,new Models.User(1,"王宁","13900000001",now.minusMonths(6),List.of(new Models.Address(1,1,"王宁","13900000001","南京市玄武区珠江路 1 号",32.05,118.79,true)),true));
        users.put(2L,new Models.User(2,"赵青","13900000002",now.minusMonths(4),List.of(new Models.Address(2,2,"赵青","13900000002","苏州市工业园区星海街 8 号",31.31,120.67,true)),true));
        users.put(3L,new Models.User(3,"李晗","13900000003",now.minusMonths(2),List.of(),true));
        goods.put(1L,new Models.Goods(1,"应急药品包","medicine",new BigDecimal("89.00"),42,0.8,1,0));
        goods.put(2L,new Models.Goods(2,"冷链餐食 A","food",new BigDecimal("42.50"),18,1.2,1,0));
        goods.put(3L,new Models.Goods(3,"工业检测仪","industry",new BigDecimal("1299.00"),5,2.4,1,0));
        goods.put(4L,new Models.Goods(4,"生活补给包","life",new BigDecimal("65.00"),0,1.6,0,0));
        pods.put(1L,new Models.Pod(1,"POD-01","南京","CLOSED",1L));
        pods.put(2L,new Models.Pod(2,"POD-02","苏州","OPEN",null));
        pods.put(3L,new Models.Pod(3,"POD-03","上海","ERROR",3L));
        bindings.put(1L,new Models.Binding(1,1,1,now.minusMonths(6),null));
        bindings.put(2L,new Models.Binding(2,1,3,now.minusMonths(5),null));
        seedMemoryFulfilment();
    }

    /**
     * Replays the seeded orders through the real rules instead of hand-placing rows.
     * Doing it this way means the simulator starts with a coherent ledger: the three
     * in-flight orders actually hold reservations, exactly as they would in production.
     */
    private void seedMemoryFulfilment() {
        memoryFulfilment = new InMemoryFulfilmentStore();
        users.values().forEach(memoryFulfilment::putUser);
        goods.values().forEach(memoryFulfilment::putGoods);
        uavs.keySet().forEach(memoryFulfilment::putUav);
        fulfilment = new FulfilmentService(memoryFulfilment);

        // Seeded orders, recreated as real reservations.
        fulfilment.createOrder(1, 1, List.of(new com.zhiyuan.fulfilment.OrderLine(1, 1)), 1L, null);
        fulfilment.createOrder(2, 2, List.of(new com.zhiyuan.fulfilment.OrderLine(2, 2)), 1L, null);
        fulfilment.createOrder(2, 2, List.of(new com.zhiyuan.fulfilment.OrderLine(3, 1)), 1L, null);
        fulfilment.dispatchOrder(2, 1, 1L);
        long deliveringTask = fulfilment.dispatchOrder(3, 2, 1L).id();
        fulfilment.transitionTask(deliveringTask, "FLYING", null, 1L);

        orders.clear();
        tasks.clear();
        projectFulfilment();
    }

    /** Copies the in-memory fulfilment state into the read-model maps the API serves from. */
    private void projectFulfilment() {
        replace(goods, memoryFulfilment.allGoods(), Models.Goods::id);
        replace(orders, memoryFulfilment.allOrders(), Models.Order::id);
        replace(tasks, memoryFulfilment.allTasks(), Models.Task::id);
    }

    /** Refreshes the read model after a fulfilment write, whichever adapter performed it. */
    private void refreshFulfilment() {
        if (database != null) reload();
        else projectFulfilment();
    }

    private void putUav(long id,String code,String name,String rfid,String model,String owner,String status,int battery,boolean pod,String region,double altitude,double speed,double lat,double lng,OffsetDateTime at) {
        uavs.put(id,new Models.Uav(id,code,name,rfid,model,owner,status,battery,pod,region,altitude,speed,lat,lng,at));
    }

    public synchronized List<Models.Uav> uavs(String query, String status, String region) {
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        return sorted(uavs).stream().filter(u -> q.isBlank() || (u.code()+u.name()+u.rfidTag()+u.model()+u.ownerName()+u.region()).toLowerCase(Locale.ROOT).contains(q))
            .filter(u -> status == null || status.isBlank() || "ALL".equals(status) || u.status().equals(status))
            .filter(u -> region == null || region.isBlank() || u.region().equals(region)).toList();
    }
    public synchronized Models.Uav uav(long id) { return required(uavs.get(id), "UAV not found"); }
    public synchronized List<Models.Alert> alerts(String level) { return sorted(alerts).stream().filter(a -> level == null || level.isBlank() || a.level().equals(level)).toList(); }
    public synchronized Models.Alert acknowledgeAlert(long id,long operatorId) { Models.Alert a=required(alerts.get(id),"Alert not found");if(!"OPEN".equals(a.status()))conflict("Alert is not open");if(database!=null){if(!database.acknowledgeAlert(id,operatorId))conflict("Alert is not open");reload();return alert(id);}Models.Alert next=new Models.Alert(a.id(),a.uavId(),a.podId(),a.title(),a.level(),a.occurredAt(),false,"ACKNOWLEDGED",operatorId,now(),null,null);alerts.put(id,next);return next; }
    public synchronized Models.Alert resolveAlert(long id,long operatorId) { Models.Alert a=required(alerts.get(id),"Alert not found");if(!"ACKNOWLEDGED".equals(a.status()))conflict("Alert must be acknowledged before resolution");if(database!=null){if(!database.resolveAlert(id,operatorId))conflict("Alert must be acknowledged before resolution");reload();return alert(id);}Models.Alert next=new Models.Alert(a.id(),a.uavId(),a.podId(),a.title(),a.level(),a.occurredAt(),true,"RESOLVED",a.acknowledgedBy(),a.acknowledgedAt(),operatorId,now());alerts.put(id,next);return next; }
    public synchronized Models.FlightLog recordFlightLog(long uavId,String event,String detail) {Models.Uav current=uav(uavId);if(database!=null){long id=database.insertFlightLog(uavId,event,detail,current.latitude(),current.longitude());return required(database.flightLog(id),"Flight log not found");}return recordMemoryFlightLog(current,event,detail);}
    public synchronized List<Models.AuditLog> auditLogs(String type,String status,Long uavId,String query) {String q=query==null?"":query.trim().toLowerCase(Locale.ROOT);return auditLogs.values().stream().filter(item->type==null||type.isBlank()||item.category().equals(type)).filter(item->status==null||status.isBlank()||item.status().equals(status)).filter(item->uavId==null||item.uavId().equals(uavId)).filter(item->q.isBlank()||(item.title()+" "+item.detail()+" "+String.valueOf(item.operatorName())).toLowerCase(Locale.ROOT).contains(q)).sorted(Comparator.comparing(Models.AuditLog::occurredAt).thenComparing(Models.AuditLog::id).reversed()).toList();}
    public synchronized AuditPage auditLogs(String type,String status,Long uavId,String query,int page,int size) {int safePage=Math.max(1,page);int safeSize=Math.min(Math.max(1,size),100);long requestedOffset=(long)(safePage-1)*safeSize;if(database!=null){long total=database.countAuditLogs(type,status,uavId,query);List<Models.AuditLog> items=requestedOffset>=total?List.of():database.auditLogs(type,status,uavId,query,requestedOffset,safeSize);return new AuditPage(items,safePage,safeSize,total,(int)Math.ceil(total/(double)safeSize));}List<Models.AuditLog> filtered=auditLogs(type,status,uavId,query);if(requestedOffset>=filtered.size())return new AuditPage(List.of(),safePage,safeSize,filtered.size(),(int)Math.ceil(filtered.size()/(double)safeSize));int from=(int)requestedOffset;int to=Math.min(from+safeSize,filtered.size());return new AuditPage(filtered.subList(from,to),safePage,safeSize,filtered.size(),(int)Math.ceil(filtered.size()/(double)safeSize));}
    public synchronized List<Models.FlightLog> flightLogs(long uavId) { return database==null?flightLogs.values().stream().filter(l->l.uavId()==uavId).sorted(Comparator.comparing(Models.FlightLog::occurredAt).thenComparing(Models.FlightLog::id).reversed()).toList():database.flightLogs(uavId); }
    public synchronized void saveCommand(Models.ControlCommand command) { saveCommand(command, 1); }
    public synchronized void saveCommand(Models.ControlCommand command,long operatorId) { if(database!=null)database.insertCommand(command,operatorId);commands.put(command.id(),command);trimCommandCache();if(database==null){String category="VOICE".equals(command.source())?"VOICE":"CONTROL";auditLogs.put("C-"+command.id(),new Models.AuditLog("C-"+command.id(),category,command.uavId(),command.type(),command.transcript()==null||command.transcript().isBlank()?command.status():command.transcript(),command.status(),command.source(),operatorId,"陈屿",command.createdAt()));} }
    public synchronized Models.ControlCommand command(String id) { return required(commands.get(id),"Command not found"); }
    public synchronized Models.ControlCommand commandStatus(String id,String status) { Models.ControlCommand c=command(id);if(database!=null)database.updateCommandStatus(id,status);Models.ControlCommand next=new Models.ControlCommand(c.id(),c.uavId(),c.type(),status,c.source(),c.transcript(),c.createdAt());commands.put(id,next);Models.AuditLog log=auditLogs.get("C-"+id);if(log!=null)auditLogs.put(log.id(),new Models.AuditLog(log.id(),log.category(),log.uavId(),log.title(),log.detail(),status,log.source(),log.operatorId(),log.operatorName(),log.occurredAt()));trimCommandCache();return next; }
    public synchronized Models.ControlCommand acknowledgeCommand(String id,String event,String detail) {Models.ControlCommand c=command(id);Models.Uav current=uav(c.uavId());if(database!=null)transact(()->{database.updateCommandStatus(id,"ACKNOWLEDGED");database.insertFlightLog(c.uavId(),event,detail,current.latitude(),current.longitude());});Models.ControlCommand next=new Models.ControlCommand(c.id(),c.uavId(),c.type(),"ACKNOWLEDGED",c.source(),c.transcript(),c.createdAt());commands.put(id,next);if(database==null)recordMemoryFlightLog(current,event,detail);Models.AuditLog log=auditLogs.get("C-"+id);if(log!=null)auditLogs.put(log.id(),new Models.AuditLog(log.id(),log.category(),log.uavId(),log.title(),log.detail(),"ACKNOWLEDGED",log.source(),log.operatorId(),log.operatorName(),log.occurredAt()));trimCommandCache();return next;}
    public synchronized List<Models.ControlCommand> commands() { return commands.values().stream().sorted(Comparator.comparing(Models.ControlCommand::createdAt).reversed()).toList(); }
    public synchronized List<Models.User> users(String query) { String q=query==null?"":query.trim(); return sorted(users).stream().filter(u -> q.isBlank() || u.username().contains(q) || u.phone().contains(q)).toList(); }
    public synchronized Models.User addUser(String username,String phone) { requirePhone(phone); if(users.values().stream().anyMatch(u->u.phone().equals(phone))) conflict("Phone already exists"); if(database!=null){long id=database.insertUser(username,phone);reload();return required(users.get(id),"User not found");} long id=userIds.incrementAndGet(); Models.User u=new Models.User(id,username,phone,now(),List.of(),true); users.put(id,u); memoryFulfilment.putUser(u); return u; }
    public synchronized Models.User updateUser(long id,String username,String phone) { requirePhone(phone); Models.User u=required(users.get(id),"User not found"); if(users.values().stream().anyMatch(candidate->candidate.id()!=id&&candidate.phone().equals(phone))) conflict("Phone already exists"); if(database!=null){database.updateUser(id,username,phone);reload();return required(users.get(id),"User not found");} Models.User next=new Models.User(id,username,phone,u.createdAt(),u.addresses(),u.enabled()); users.put(id,next); memoryFulfilment.putUser(next); return next; }
    /**
     * Removes a customer, or disables one that orders still reference. Physically deleting
     * a customer with order history would orphan the orders and silently rewrite the past
     * (CONTEXT.md §1); a disabled customer keeps their history and can place no new orders.
     */
    public synchronized void deleteUser(long id) {
        Models.User existing = required(users.get(id), "User not found");
        if (database != null) {
            if (database.countOrdersForUser(id) > 0) database.disableUser(id);
            else database.deleteUser(id);
            reload();
            return;
        }
        boolean referenced = orders.values().stream().anyMatch(order -> order.userId() == id);
        if (referenced) {
            Models.User disabled = new Models.User(existing.id(), existing.username(), existing.phone(),
                existing.createdAt(), existing.addresses(), false);
            users.put(id, disabled);
            memoryFulfilment.putUser(disabled);
            return;
        }
        users.remove(id);
    }
    public synchronized Models.Address addAddress(long userId,String name,String phone,String detail,double lat,double lng,boolean makeDefault) { requirePhone(phone); Models.User user=required(users.get(userId),"User not found"); boolean targetDefault=makeDefault || user.addresses().isEmpty(); if(database!=null){long[] id={0};transact(()->id[0]=database.insertAddress(userId,name,phone,detail,lat,lng,targetDefault));reload();return users.get(userId).addresses().stream().filter(a->a.id()==id[0]).findFirst().orElseThrow();} long id=addressIds.incrementAndGet(); List<Models.Address> list=new ArrayList<>(); for(Models.Address a:user.addresses()) list.add(new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),targetDefault?false:a.isDefault())); Models.Address address=new Models.Address(id,userId,name,phone,detail,lat,lng,targetDefault); list.add(address); users.put(userId,withAddresses(user,List.copyOf(list))); return address; }
    public synchronized void deleteAddress(long userId,long addressId) { Models.User user=required(users.get(userId),"User not found"); Models.Address removed=user.addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow(()->notFound("Address not found")); if(database!=null){Long nextDefault=removed.isDefault()?user.addresses().stream().filter(a->a.id()!=addressId).map(Models.Address::id).findFirst().orElse(null):null;transact(()->{database.deleteAddress(userId,addressId);if(nextDefault!=null)database.setDefaultAddress(userId,nextDefault);});reload();return;} List<Models.Address> list=user.addresses().stream().filter(a->a.id()!=addressId).toList(); if(!list.isEmpty()&&list.stream().noneMatch(Models.Address::isDefault)){ Models.Address a=list.get(0); List<Models.Address> fixed=new ArrayList<>(list); fixed.set(0,new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),true)); list=List.copyOf(fixed); } users.put(userId,withAddresses(user,list)); }
    public synchronized Models.Address updateAddress(long userId,long addressId,String name,String phone,String detail,double lat,double lng,boolean makeDefault) { requirePhone(phone);Models.User user=required(users.get(userId),"User not found");Models.Address current=user.addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow(()->notFound("Address not found"));boolean targetDefault=makeDefault||current.isDefault();if(database!=null){transact(()->database.updateAddress(userId,addressId,name,phone,detail,lat,lng,targetDefault));reload();return users.get(userId).addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow();}List<Models.Address> list=user.addresses().stream().map(a->a.id()==addressId?new Models.Address(a.id(),a.userId(),name,phone,detail,lat,lng,targetDefault):targetDefault?new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),false):a).toList();users.put(userId,withAddresses(user,list));return list.stream().filter(a->a.id()==addressId).findFirst().orElseThrow();}
    public synchronized Models.Address setDefaultAddress(long userId,long addressId) { Models.User user=required(users.get(userId),"User not found"); Models.Address existing=user.addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow(()->notFound("Address not found")); if(database!=null){database.setDefaultAddress(userId,addressId);reload();return users.get(userId).addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow();} Models.Address[] selected={null}; List<Models.Address> list=user.addresses().stream().map(a->{ boolean d=a.id()==addressId; Models.Address next=new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),d); if(d) selected[0]=next; return next; }).toList(); users.put(userId,withAddresses(user,list)); return existing.isDefault()?existing:selected[0]; }
    public synchronized List<Models.Goods> goods(String query,String category) { String q=query==null?"":query.trim(); return sorted(goods).stream().filter(g->q.isBlank()||g.name().contains(q)).filter(g->category==null||category.isBlank()||g.category().equals(category)).toList(); }
    public synchronized Models.Goods addGoods(String name,String category,BigDecimal price,int stock,double weight,int status) { validateGoods(category,price,stock,weight,status); if(database!=null){long id=database.insertGoods(name,category,price,stock,weight,status);reload();return required(goods.get(id),"Goods not found");} long id=goodsIds.incrementAndGet(); Models.Goods item=new Models.Goods(id,name,category,price,stock,weight,status,0); goods.put(id,item); memoryFulfilment.putGoods(item); return item; }
    /** {@code stock} is available stock; whatever orders have reserved is left untouched. */
    public synchronized Models.Goods updateGoods(long id,String name,String category,BigDecimal price,int stock,double weight,int status) { Models.Goods existing=required(goods.get(id),"Goods not found"); validateGoods(category,price,stock,weight,status); if(database!=null){database.updateGoods(id,name,category,price,stock,weight,status);reload();return required(goods.get(id),"Goods not found");} Models.Goods item=new Models.Goods(id,name,category,price,stock,weight,status,existing.reservedStock()); goods.put(id,item); memoryFulfilment.putGoods(item); return item; }
    /** Delists a product that orders reference; deletes one that nothing does. */
    public synchronized void deleteGoods(long id) {
        Models.Goods existing = required(goods.get(id), "Goods not found");
        if (database != null) {
            if (database.countOrderItemsForGoods(id) > 0) database.updateGoodsStatus(id, 0);
            else database.deleteGoods(id);
            reload();
            return;
        }
        boolean referenced = existing.reservedStock() > 0
            || orders.values().stream().flatMap(order -> order.items().stream()).anyMatch(item -> item.goodsId() == id);
        if (referenced) {
            Models.Goods delisted = new Models.Goods(existing.id(), existing.name(), existing.category(),
                existing.price(), existing.stock(), existing.weight(), 0, existing.reservedStock());
            goods.put(id, delisted);
            memoryFulfilment.putGoods(delisted);
            return;
        }
        goods.remove(id);
    }
    /** Batch form of {@link #deleteGoods(long)}: each product is delisted or deleted on its own merits. */
    public synchronized void deleteGoods(Set<Long> ids) {
        ids.forEach(id -> required(goods.get(id), "Goods not found"));
        if (database != null) {
            transact(() -> ids.forEach(id -> {
                if (database.countOrderItemsForGoods(id) > 0) database.updateGoodsStatus(id, 0);
                else database.deleteGoods(id);
            }));
            reload();
            return;
        }
        ids.forEach(this::deleteGoods);
    }
    public synchronized Models.Goods toggleGoods(long id) { Models.Goods g=required(goods.get(id),"Goods not found"); int status=g.status()==1?0:1;if(database!=null){database.updateGoodsStatus(id,status);reload();return required(goods.get(id),"Goods not found");} Models.Goods next=new Models.Goods(g.id(),g.name(),g.category(),g.price(),g.stock(),g.weight(),status,g.reservedStock()); goods.put(id,next); memoryFulfilment.putGoods(next); return next; }
    public synchronized List<Models.Order> orders(String status) { return sorted(orders).stream().filter(o->status==null||status.isBlank()||o.status().equals(status)).toList(); }
    public synchronized Models.Order order(long id) { return required(orders.get(id),"Order not found"); }
    public synchronized Models.Order createOrder(long userId,long addressId,List<OrderLine> lines) {
        return createOrder(userId, addressId, lines, null, null);
    }

    /**
     * Creates an order and reserves its stock. Both data modes take the same path through
     * {@link FulfilmentService}; the only difference is which adapter is underneath.
     */
    public synchronized Models.Order createOrder(long userId, long addressId, List<OrderLine> lines,
                                                 Long operatorId, String idempotencyKey) {
        List<com.zhiyuan.fulfilment.OrderLine> domainLines = lines == null ? List.of()
            : lines.stream().map(line -> new com.zhiyuan.fulfilment.OrderLine(line.goodsId(), line.count())).toList();
        Models.Order created = fulfilment.createOrder(userId, addressId, domainLines, operatorId, idempotencyKey);
        refreshFulfilment();
        return created;
    }
    /**
     * Direct status edit, kept for the operations console. Dispatch, cancel and task-driven
     * transitions go through their own methods so the inventory side-effects come with them.
     */
    /**
     * Cancels an order. Other transitions are not available as a bare status edit: every
     * one of them carries an inventory consequence, so they must go through
     * {@link #dispatch} or {@link #transitionTask} where the ledger is written with them
     * (ADR 0001). A status-only write would leave stock and status disagreeing.
     */
    public synchronized Models.Order transitionOrder(long id, String target) {
        return transitionOrder(id, target, null);
    }

    public synchronized Models.Order transitionOrder(long id, String target, Long operatorId) {
        order(id);
        if ("CANCELLED".equals(target)) return cancelOrder(id, operatorId);
        throw new FulfilmentConflictException(
            "Order status '" + target + "' is reached through dispatch or a task transition,"
                + " not through a direct status edit");
    }
    public synchronized Models.Task dispatch(long orderId,long uavId) {
        return dispatch(orderId, uavId, null);
    }

    public synchronized Models.Task dispatch(long orderId, long uavId, Long operatorId) {
        uav(uavId);
        Models.Task task = fulfilment.dispatchOrder(orderId, uavId, operatorId);
        refreshFulfilment();
        return task;
    }
    public synchronized Models.Order cancelOrder(long id) {
        return cancelOrder(id, null);
    }

    /** Cancels the order, releases every reservation it still holds and fails an active task. */
    public synchronized Models.Order cancelOrder(long id, Long operatorId) {
        Models.Order cancelled = fulfilment.cancelOrder(id, operatorId, "cancelled by operator");
        refreshFulfilment();
        return cancelled;
    }
    public synchronized List<Models.Task> tasks(String status) { return sorted(tasks).stream().filter(t->status==null||status.isBlank()||t.taskStatus().equals(status)).toList(); }
    public synchronized Models.Task transitionTask(long id,String target) { return transitionTask(id,target,null); }
    public synchronized Models.Task transitionTask(long id,String target,String failureReason) {
        return transitionTask(id, target, failureReason, null);
    }

    /**
     * Moves the task, mirrors the order status and settles the reservation: ARRIVED consumes
     * it, FAILED deliberately keeps it so the order can be re-dispatched (ADR 0001).
     */
    public synchronized Models.Task transitionTask(long id, String target, String failureReason,
                                                   Long operatorId) {
        Models.Task before = fulfilmentTask(id);
        Models.Uav current = uav(before.uavId());
        Models.Task task = fulfilment.transitionTask(id, target, failureReason, operatorId);
        refreshFulfilment();

        String event = "FLYING".equals(target) ? "配送任务起飞" : "ARRIVED".equals(target) ? "配送任务到达" : null;
        if (event != null) {
            String detail = "任务 TSK-" + String.format("%04d", id);
            if (database != null) database.insertFlightLog(current.id(), event, detail, current.latitude(), current.longitude());
            else recordMemoryFlightLog(current, event, detail);
        }
        return task;
    }

    private Models.Task fulfilmentTask(long id) {
        return required(tasks.get(id), "Task not found");
    }

    /** The immutable movement history behind an order's current stock position. */
    public synchronized List<Models.LedgerEntry> inventoryLedger(long orderId) {
        order(orderId);
        return fulfilment.ledger(orderId);
    }

    /** Who moved this order between states, when, and why. */
    public synchronized List<Models.OrderStatusChange> orderHistory(long orderId) {
        order(orderId);
        return fulfilment.history(orderId);
    }
    public synchronized List<Models.Pod> pods() { return sorted(pods); }
    public synchronized Models.Pod updatePod(long id,String doorStatus,Long uavId) { Models.Pod p=required(pods.get(id),"Pod not found"); if(!Set.of("OPEN","CLOSED","ERROR").contains(doorStatus)) throw new IllegalArgumentException("Invalid door status"); if(uavId!=null) uav(uavId); if(database!=null){database.updatePod(id,doorStatus,uavId);reload();return required(pods.get(id),"Pod not found");} Models.Pod next=new Models.Pod(p.id(),p.name(),p.region(),doorStatus,uavId); pods.put(id,next); return next; }
    public synchronized List<Models.Binding> bindings() { return sorted(bindings); }
    public synchronized Models.Binding bind(long staffId,long uavId) { uav(uavId); if(bindings.values().stream().anyMatch(b->b.staffId()==staffId&&b.uavId()==uavId&&b.unboundAt()==null)) conflict("Device already bound"); if(database!=null){long id=database.insertBinding(staffId,uavId);reload();return required(bindings.get(id),"Binding not found");} long id=bindingIds.incrementAndGet(); Models.Binding binding=new Models.Binding(id,staffId,uavId,now(),null); bindings.put(id,binding); return binding; }
    public synchronized void unbind(long id) { Models.Binding binding=required(bindings.get(id),"Binding not found");if(binding.unboundAt()!=null)conflict("Binding already revoked");if(database!=null){database.unbind(id);reload();return;}bindings.put(id,new Models.Binding(binding.id(),binding.staffId(),binding.uavId(),binding.boundAt(),now())); }
    public synchronized Models.Dashboard dashboard() { return new Models.Dashboard(uavs.size(),uavs.values().stream().filter(u->!"OFFLINE".equals(u.status())).count(),uavs.values().stream().filter(Models.Uav::inHibernatePod).count(),alerts.values().stream().filter(Predicate.not(Models.Alert::resolved)).count()); }
    public synchronized List<Map<String,Object>> search(String query) { String q=query==null?"":query.trim().toLowerCase(Locale.ROOT); if(q.isBlank()) return List.of(); List<Map<String,Object>> result=new ArrayList<>(); uavs(q,null,null).forEach(u->result.add(Map.of("type","uav","id",u.id(),"title",u.code()+" · "+u.name(),"href","/uavs/detail?id="+u.id()))); users(q).forEach(u->result.add(Map.of("type","user","id",u.id(),"title",u.username()+" · "+u.phone(),"href","/users?id="+u.id()))); goods(q,null).forEach(g->result.add(Map.of("type","goods","id",g.id(),"title",g.name(),"href","/goods?id="+g.id()))); orders.values().stream().filter(o->o.orderNo().toLowerCase(Locale.ROOT).contains(q)).forEach(o->result.add(Map.of("type","order","id",o.id(),"title",o.orderNo(),"href","/orders/detail?id="+o.id()))); tasks.values().stream().filter(t->("tsk-"+t.id()+" "+t.taskStatus()+" "+t.orderId()).toLowerCase(Locale.ROOT).contains(q)).forEach(t->result.add(Map.of("type","task","id",t.id(),"title","TSK-"+String.format("%04d",t.id())+" · "+t.taskStatus(),"href","/tasks?id="+t.id()))); return result.stream().limit(30).toList(); }

    public synchronized long staffId(String username) { return database == null ? 1 : database.staffId(username); }

    private Models.Alert alert(long id) { return required(alerts.get(id), "Alert not found"); }

    private static Models.User withAddresses(Models.User user, List<Models.Address> addresses) {
        return new Models.User(user.id(), user.username(), user.phone(), user.createdAt(), addresses,
            user.enabled());
    }

    private Models.FlightLog recordMemoryFlightLog(Models.Uav uav,String event,String detail) {long id=flightLogs.keySet().stream().mapToLong(Long::longValue).max().orElse(0)+1;Models.FlightLog log=new Models.FlightLog(id,uav.id(),event,detail,uav.latitude(),uav.longitude(),now());flightLogs.put(id,log);auditLogs.put("F-"+id,new Models.AuditLog("F-"+id,"FLIGHT",uav.id(),event,detail,"RECORDED","UAV",null,null,log.occurredAt()));return log;}

    private void trimCommandCache() {if(commands.size()<=500)return;commands.values().stream().filter(command->Set.of("ACKNOWLEDGED","FAILED","TIMEOUT").contains(command.status())).min(Comparator.comparing(Models.ControlCommand::createdAt).thenComparing(Models.ControlCommand::id)).ifPresent(oldest->commands.remove(oldest.id()));}

    private void transact(Runnable action) {
        if (transactions == null) action.run();
        else transactions.executeWithoutResult(status -> action.run());
    }

    /**
     * Reloads just the device snapshots.
     *
     * <p>Telemetry is written straight to the database by the ingest path rather than
     * through this store, so without this the cached fleet would go stale the moment a
     * device moved — the REST list and the SSE stream would then disagree.
     */
    public synchronized void refreshDevices() {
        if (database == null) return;
        replace(uavs, database.uavs(), Models.Uav::id);
    }

    /** Device roster for the simulator, keyed by the business code rather than the row id. */
    public synchronized List<Models.Uav> devices() {
        return sorted(uavs);
    }

    private synchronized void reload() {
        PlatformDatabase.Snapshot snapshot = database.snapshot();
        replace(uavs, snapshot.uavs(), Models.Uav::id);
        replace(alerts, snapshot.alerts(), Models.Alert::id);
        commands.clear(); snapshot.commands().forEach(command -> commands.put(command.id(), command));
        replace(users, snapshot.users(), Models.User::id);
        replace(goods, snapshot.goods(), Models.Goods::id);
        replace(orders, snapshot.orders(), Models.Order::id);
        replace(tasks, snapshot.tasks(), Models.Task::id);
        replace(pods, snapshot.pods(), Models.Pod::id);
        replace(bindings, snapshot.bindings(), Models.Binding::id);
    }

    private static <T> void replace(Map<Long,T> target,List<T> values,java.util.function.ToLongFunction<T> id) { target.clear(); values.forEach(value -> target.put(id.applyAsLong(value), value)); }

    private static OffsetDateTime now(){return OffsetDateTime.now(OFFSET).withNano(0);}
    private static <T> List<T> sorted(Map<Long,T> map){return map.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(Map.Entry::getValue).toList();}
    private static <T> T required(T value,String message){if(value==null)throw notFound(message);return value;}
    private static ResponseStatusException notFound(String message){return new ResponseStatusException(HttpStatus.NOT_FOUND,message);}
    private static void conflict(String message){throw new ResponseStatusException(HttpStatus.CONFLICT,message);}
    private static void requirePhone(String phone){if(phone==null||!phone.matches("^1[3-9]\\d{9}$"))throw new IllegalArgumentException("Invalid mobile phone");}
    private static void validateGoods(String category,BigDecimal price,int stock,double weight,int status){if(!Set.of("food","medicine","life","industry").contains(category)||price.signum()<0||stock<0||weight<0||(status!=0&&status!=1))throw new IllegalArgumentException("Invalid goods data");}
}
