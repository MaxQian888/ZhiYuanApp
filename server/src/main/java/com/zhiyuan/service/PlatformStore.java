package com.zhiyuan.service;

import com.zhiyuan.domain.Models;
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
    private final AtomicLong userIds = new AtomicLong(3);
    private final AtomicLong addressIds = new AtomicLong(2);
    private final AtomicLong goodsIds = new AtomicLong(4);
    private final AtomicLong taskIds = new AtomicLong(2);
    private final AtomicLong bindingIds = new AtomicLong(2);
    private PlatformDatabase database;
    private TransactionTemplate transactions;

    public PlatformStore() {
        seedMemory();
    }

    @Autowired
    public PlatformStore(PlatformDatabase database, PlatformTransactionManager transactionManager) {
        this.database = database;
        this.transactions = new TransactionTemplate(transactionManager);
        reload();
    }

    private void seedMemory() {
        OffsetDateTime now = now();
        putUav(1,"UAV-01","巡检一号","RFID-0001","DJI Mavic 3","陈屿","ONLINE",78,true,"南京",30,5.2,32.06,118.78,now);
        putUav(2,"UAV-02","配送二号","RFID-0002","DJI Air 2S","林潇","FLYING",42,false,"苏州",82,12.4,31.30,120.62,now);
        putUav(3,"UAV-03","应急三号","RFID-0003","Autel EVO II","陈屿","CHARGING",15,true,"上海",0,0,31.23,121.47,now);
        putUav(4,"UAV-04","巡检四号","RFID-0004","DJI Mini 4 Pro","周衡","OFFLINE",0,false,"杭州",0,0,30.27,120.15,now.minusHours(13));
        putUav(5,"UAV-05","配送五号","RFID-0005","DJI Matrice 30","林潇","ONLINE",63,false,"无锡",12,2.4,31.49,120.31,now);
        putUav(6,"UAV-06","备勤六号","RFID-0006","Autel Alpha","周衡","ONLINE",91,false,"南京",0,0,32.07,118.80,now);
        alerts.put(1L,new Models.Alert(1,2L,"UAV-02 电量低于 45%","HIGH",now.minusMinutes(3),false));
        alerts.put(2L,new Models.Alert(2,5L,"UAV-05 信号弱","MID",now.minusMinutes(37),false));
        alerts.put(3L,new Models.Alert(3,null,"3 号休眠仓舱门异常","LOW",now.minusHours(16),false));
        flightLogs.put(1L,new Models.FlightLog(1,2,"任务起飞","订单 ZY-20260812-003",now.minusMinutes(21)));
        flightLogs.put(2L,new Models.FlightLog(2,1,"遥测同步","高度 30m，速度 5.2m/s",now.minusMinutes(23)));
        flightLogs.put(3L,new Models.FlightLog(3,3,"进入充电","休眠仓 POD-03",now.minusMinutes(28)));
        users.put(1L,new Models.User(1,"王宁","13900000001",now.minusMonths(6),List.of(new Models.Address(1,1,"王宁","13900000001","南京市玄武区珠江路 1 号",32.05,118.79,true))));
        users.put(2L,new Models.User(2,"赵青","13900000002",now.minusMonths(4),List.of(new Models.Address(2,2,"赵青","13900000002","苏州市工业园区星海街 8 号",31.31,120.67,true))));
        users.put(3L,new Models.User(3,"李晗","13900000003",now.minusMonths(2),List.of()));
        goods.put(1L,new Models.Goods(1,"应急药品包","medicine",new BigDecimal("89.00"),42,0.8,1));
        goods.put(2L,new Models.Goods(2,"冷链餐食 A","food",new BigDecimal("42.50"),18,1.2,1));
        goods.put(3L,new Models.Goods(3,"工业检测仪","industry",new BigDecimal("1299.00"),5,2.4,1));
        goods.put(4L,new Models.Goods(4,"生活补给包","life",new BigDecimal("65.00"),0,1.6,0));
        Models.AddressSnapshot wang=new Models.AddressSnapshot("王宁","13900000001","南京市玄武区珠江路 1 号");
        Models.AddressSnapshot zhao=new Models.AddressSnapshot("赵青","13900000002","苏州市工业园区星海街 8 号");
        orders.put(1L,new Models.Order(1,"ZY-20260812-001",1,1,new BigDecimal("89.00"),"CREATED",now.minusMinutes(74),wang,List.of(new Models.OrderItem(1,1,"应急药品包",1,new BigDecimal("89.00")))));
        orders.put(2L,new Models.Order(2,"ZY-20260812-002",2,2,new BigDecimal("85.00"),"DISPATCHING",now.minusMinutes(52),zhao,List.of(new Models.OrderItem(2,2,"冷链餐食 A",2,new BigDecimal("42.50")))));
        orders.put(3L,new Models.Order(3,"ZY-20260812-003",2,2,new BigDecimal("1299.00"),"DELIVERING",now.minusMinutes(34),zhao,List.of(new Models.OrderItem(3,3,"工业检测仪",1,new BigDecimal("1299.00")))));
        tasks.put(1L,new Models.Task(1,2,1,"WAITING",null,null,null));
        tasks.put(2L,new Models.Task(2,3,2,"FLYING",now.minusMinutes(21),null,null));
        pods.put(1L,new Models.Pod(1,"POD-01","南京","CLOSED",1L));
        pods.put(2L,new Models.Pod(2,"POD-02","苏州","OPEN",null));
        pods.put(3L,new Models.Pod(3,"POD-03","上海","ERROR",3L));
        bindings.put(1L,new Models.Binding(1,1,1,now.minusMonths(6),null));
        bindings.put(2L,new Models.Binding(2,1,3,now.minusMonths(5),null));
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
    public synchronized Models.Alert resolveAlert(long id) { Models.Alert a=required(alerts.get(id),"Alert not found"); if(database!=null){database.resolveAlert(id);reload();return alert(id);} Models.Alert next=new Models.Alert(a.id(),a.uavId(),a.title(),a.level(),a.occurredAt(),true); alerts.put(id,next); return next; }
    public synchronized List<Models.FlightLog> flightLogs(long uavId) { return sorted(flightLogs).stream().filter(l -> l.uavId()==uavId).toList(); }
    public synchronized void saveCommand(Models.ControlCommand command) { saveCommand(command, 1); }
    public synchronized void saveCommand(Models.ControlCommand command,long operatorId) { if(database!=null){database.insertCommand(command,operatorId);reload();return;} commands.put(command.id(),command); }
    public synchronized Models.ControlCommand command(String id) { return required(commands.get(id),"Command not found"); }
    public synchronized Models.ControlCommand commandStatus(String id,String status) { Models.ControlCommand c=command(id); if(database!=null){database.updateCommandStatus(id,status);reload();return command(id);} Models.ControlCommand next=new Models.ControlCommand(c.id(),c.uavId(),c.type(),status,c.source(),c.transcript(),c.createdAt()); commands.put(id,next); return next; }
    public synchronized List<Models.ControlCommand> commands() { return commands.values().stream().sorted(Comparator.comparing(Models.ControlCommand::createdAt).reversed()).toList(); }
    public synchronized List<Models.User> users(String query) { String q=query==null?"":query.trim(); return sorted(users).stream().filter(u -> q.isBlank() || u.username().contains(q) || u.phone().contains(q)).toList(); }
    public synchronized Models.User addUser(String username,String phone) { requirePhone(phone); if(users.values().stream().anyMatch(u->u.phone().equals(phone))) conflict("Phone already exists"); if(database!=null){long id=database.insertUser(username,phone);reload();return required(users.get(id),"User not found");} long id=userIds.incrementAndGet(); Models.User u=new Models.User(id,username,phone,now(),List.of()); users.put(id,u); return u; }
    public synchronized Models.User updateUser(long id,String username,String phone) { requirePhone(phone); Models.User u=required(users.get(id),"User not found"); if(users.values().stream().anyMatch(candidate->candidate.id()!=id&&candidate.phone().equals(phone))) conflict("Phone already exists"); if(database!=null){database.updateUser(id,username,phone);reload();return required(users.get(id),"User not found");} Models.User next=new Models.User(id,username,phone,u.createdAt(),u.addresses()); users.put(id,next); return next; }
    public synchronized void deleteUser(long id) { required(users.get(id),"User not found"); if(database!=null){database.deleteUser(id);reload();return;} users.remove(id); }
    public synchronized Models.Address addAddress(long userId,String name,String phone,String detail,double lat,double lng,boolean makeDefault) { requirePhone(phone); Models.User user=required(users.get(userId),"User not found"); boolean targetDefault=makeDefault || user.addresses().isEmpty(); if(database!=null){long[] id={0};transact(()->id[0]=database.insertAddress(userId,name,phone,detail,lat,lng,targetDefault));reload();return users.get(userId).addresses().stream().filter(a->a.id()==id[0]).findFirst().orElseThrow();} long id=addressIds.incrementAndGet(); List<Models.Address> list=new ArrayList<>(); for(Models.Address a:user.addresses()) list.add(new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),targetDefault?false:a.isDefault())); Models.Address address=new Models.Address(id,userId,name,phone,detail,lat,lng,targetDefault); list.add(address); users.put(userId,new Models.User(user.id(),user.username(),user.phone(),user.createdAt(),List.copyOf(list))); return address; }
    public synchronized void deleteAddress(long userId,long addressId) { Models.User user=required(users.get(userId),"User not found"); Models.Address removed=user.addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow(()->notFound("Address not found")); if(database!=null){Long nextDefault=removed.isDefault()?user.addresses().stream().filter(a->a.id()!=addressId).map(Models.Address::id).findFirst().orElse(null):null;transact(()->{database.deleteAddress(userId,addressId);if(nextDefault!=null)database.setDefaultAddress(userId,nextDefault);});reload();return;} List<Models.Address> list=user.addresses().stream().filter(a->a.id()!=addressId).toList(); if(!list.isEmpty()&&list.stream().noneMatch(Models.Address::isDefault)){ Models.Address a=list.get(0); List<Models.Address> fixed=new ArrayList<>(list); fixed.set(0,new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),true)); list=List.copyOf(fixed); } users.put(userId,new Models.User(user.id(),user.username(),user.phone(),user.createdAt(),list)); }
    public synchronized Models.Address updateAddress(long userId,long addressId,String name,String phone,String detail,double lat,double lng,boolean makeDefault) { requirePhone(phone);Models.User user=required(users.get(userId),"User not found");Models.Address current=user.addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow(()->notFound("Address not found"));boolean targetDefault=makeDefault||current.isDefault();if(database!=null){transact(()->database.updateAddress(userId,addressId,name,phone,detail,lat,lng,targetDefault));reload();return users.get(userId).addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow();}List<Models.Address> list=user.addresses().stream().map(a->a.id()==addressId?new Models.Address(a.id(),a.userId(),name,phone,detail,lat,lng,targetDefault):targetDefault?new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),false):a).toList();users.put(userId,new Models.User(user.id(),user.username(),user.phone(),user.createdAt(),list));return list.stream().filter(a->a.id()==addressId).findFirst().orElseThrow();}
    public synchronized Models.Address setDefaultAddress(long userId,long addressId) { Models.User user=required(users.get(userId),"User not found"); Models.Address existing=user.addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow(()->notFound("Address not found")); if(database!=null){database.setDefaultAddress(userId,addressId);reload();return users.get(userId).addresses().stream().filter(a->a.id()==addressId).findFirst().orElseThrow();} Models.Address[] selected={null}; List<Models.Address> list=user.addresses().stream().map(a->{ boolean d=a.id()==addressId; Models.Address next=new Models.Address(a.id(),a.userId(),a.receiverName(),a.receiverPhone(),a.detail(),a.latitude(),a.longitude(),d); if(d) selected[0]=next; return next; }).toList(); users.put(userId,new Models.User(user.id(),user.username(),user.phone(),user.createdAt(),list)); return existing.isDefault()?existing:selected[0]; }
    public synchronized List<Models.Goods> goods(String query,String category) { String q=query==null?"":query.trim(); return sorted(goods).stream().filter(g->q.isBlank()||g.name().contains(q)).filter(g->category==null||category.isBlank()||g.category().equals(category)).toList(); }
    public synchronized Models.Goods addGoods(String name,String category,BigDecimal price,int stock,double weight,int status) { validateGoods(category,price,stock,weight,status); if(database!=null){long id=database.insertGoods(name,category,price,stock,weight,status);reload();return required(goods.get(id),"Goods not found");} long id=goodsIds.incrementAndGet(); Models.Goods item=new Models.Goods(id,name,category,price,stock,weight,status); goods.put(id,item); return item; }
    public synchronized Models.Goods updateGoods(long id,String name,String category,BigDecimal price,int stock,double weight,int status) { required(goods.get(id),"Goods not found"); validateGoods(category,price,stock,weight,status); if(database!=null){database.updateGoods(id,name,category,price,stock,weight,status);reload();return required(goods.get(id),"Goods not found");} Models.Goods item=new Models.Goods(id,name,category,price,stock,weight,status); goods.put(id,item); return item; }
    public synchronized void deleteGoods(long id) { required(goods.get(id),"Goods not found"); if(database!=null){database.deleteGoods(id);reload();return;} goods.remove(id); }
    public synchronized void deleteGoods(Set<Long> ids) { ids.forEach(id->required(goods.get(id),"Goods not found"));if(database!=null){transact(()->database.deleteGoods(ids));reload();return;}ids.forEach(goods::remove); }
    public synchronized Models.Goods toggleGoods(long id) { Models.Goods g=required(goods.get(id),"Goods not found"); int status=g.status()==1?0:1;if(database!=null){database.updateGoodsStatus(id,status);reload();return required(goods.get(id),"Goods not found");} Models.Goods next=new Models.Goods(g.id(),g.name(),g.category(),g.price(),g.stock(),g.weight(),status); goods.put(id,next); return next; }
    public synchronized List<Models.Order> orders(String status) { return sorted(orders).stream().filter(o->status==null||status.isBlank()||o.status().equals(status)).toList(); }
    public synchronized Models.Order order(long id) { return required(orders.get(id),"Order not found"); }
    public synchronized Models.Order createOrder(long userId,long addressId,List<OrderLine> lines) { Models.User user=required(users.get(userId),"User not found");Models.Address address=user.addresses().stream().filter(item->item.id()==addressId).findFirst().orElseThrow(()->notFound("Address not found"));if(lines==null||lines.isEmpty()||lines.stream().anyMatch(line->line.count()<=0))throw new IllegalArgumentException("Order must contain positive item quantities");List<Models.OrderItem> items=new ArrayList<>();BigDecimal total=BigDecimal.ZERO;long itemId=1;for(OrderLine line:lines){Models.Goods item=required(goods.get(line.goodsId()),"Goods not found");if(item.status()!=1)conflict("Goods is unavailable: "+item.name());if(item.stock()<line.count())conflict("Insufficient stock: "+item.name());items.add(new Models.OrderItem(itemId++,item.id(),item.name(),line.count(),item.price()));total=total.add(item.price().multiply(BigDecimal.valueOf(line.count())));}String orderNo="ZY-"+now().format(DateTimeFormatter.ofPattern("yyyyMMdd"))+"-"+UUID.randomUUID().toString().substring(0,8).toUpperCase(Locale.ROOT);Models.AddressSnapshot snapshot=new Models.AddressSnapshot(address.receiverName(),address.receiverPhone(),address.detail());if(database!=null){long[] id={0};BigDecimal finalTotal=total;transact(()->{id[0]=database.insertOrder(orderNo,userId,addressId,snapshot,finalTotal);for(OrderLine line:lines){Models.Goods item=goods.get(line.goodsId());if(!database.decrementStock(item.id(),line.count()))conflict("Insufficient stock: "+item.name());database.insertOrderItem(id[0],item,line.count());}});reload();return order(id[0]);}long id=orders.keySet().stream().mapToLong(Long::longValue).max().orElse(0)+1;Models.Order created=new Models.Order(id,orderNo,userId,addressId,total,"CREATED",now(),snapshot,List.copyOf(items));orders.put(id,created);for(OrderLine line:lines){Models.Goods item=goods.get(line.goodsId());goods.put(item.id(),new Models.Goods(item.id(),item.name(),item.category(),item.price(),item.stock()-line.count(),item.weight(),item.status()));}return created; }
    public synchronized Models.Order transitionOrder(long id,String target) { Models.Order o=order(id); Map<String,Set<String>> allowed=Map.of("CREATED",Set.of("DISPATCHING","CANCELLED"),"DISPATCHING",Set.of("DELIVERING","CANCELLED","ERROR"),"DELIVERING",Set.of("FINISHED","ERROR"),"ERROR",Set.of("DISPATCHING","CANCELLED"),"FINISHED",Set.of(),"CANCELLED",Set.of()); if(!allowed.getOrDefault(o.status(),Set.of()).contains(target)) conflict("Illegal order transition: "+o.status()+" -> "+target); if(database!=null){database.updateOrderStatus(id,target);reload();return order(id);} Models.Order next=new Models.Order(o.id(),o.orderNo(),o.userId(),o.addressId(),o.totalPrice(),target,o.createdAt(),o.addressSnapshot(),o.items()); orders.put(id,next); return next; }
    public synchronized Models.Task dispatch(long orderId,long uavId) { uav(uavId); Models.Order order=order(orderId); if(!Set.of("CREATED","ERROR").contains(order.status())) conflict("Order cannot be dispatched"); Models.Task previous=tasks.values().stream().filter(task->task.orderId()==orderId).findFirst().orElse(null);if(database!=null){if(previous!=null&&!"FAILED".equals(previous.taskStatus()))conflict("Order already has an active task");long[] id={previous==null?0:previous.id()};transact(()->{database.updateOrderStatus(orderId,"DISPATCHING");if(previous!=null)database.resetTask(previous.id(),uavId);else id[0]=database.insertTask(orderId,uavId);});reload();return required(tasks.get(id[0]),"Task not found");}transitionOrder(orderId,"DISPATCHING");if(previous!=null){Models.Task reset=new Models.Task(previous.id(),orderId,uavId,"WAITING",null,null,null);tasks.put(previous.id(),reset);return reset;}long id=taskIds.incrementAndGet(); Models.Task task=new Models.Task(id,orderId,uavId,"WAITING",null,null,null); tasks.put(id,task); return task; }
    public synchronized Models.Order cancelOrder(long id) { Models.Order order=order(id);if(!Set.of("CREATED","DISPATCHING","ERROR").contains(order.status()))conflict("Order cannot be cancelled");Models.Task active=tasks.values().stream().filter(task->task.orderId()==id&&Set.of("WAITING","FLYING").contains(task.taskStatus())).findFirst().orElse(null);if(database!=null){transact(()->{if(active!=null)database.terminateTask(active.id(),"ORDER_CANCELLED");database.updateOrderStatus(id,"CANCELLED");});reload();return order(id);}if(active!=null)tasks.put(active.id(),new Models.Task(active.id(),active.orderId(),active.uavId(),"FAILED",active.startTime(),now(),"ORDER_CANCELLED"));Models.Order cancelled=new Models.Order(order.id(),order.orderNo(),order.userId(),order.addressId(),order.totalPrice(),"CANCELLED",order.createdAt(),order.addressSnapshot(),order.items());orders.put(id,cancelled);return cancelled; }
    public synchronized List<Models.Task> tasks(String status) { return sorted(tasks).stream().filter(t->status==null||status.isBlank()||t.taskStatus().equals(status)).toList(); }
    public synchronized Models.Task transitionTask(long id,String target) { return transitionTask(id,target,null); }
    public synchronized Models.Task transitionTask(long id,String target,String failureReason) { Models.Task t=required(tasks.get(id),"Task not found"); Map<String,Set<String>> allowed=Map.of("WAITING",Set.of("FLYING","FAILED"),"FLYING",Set.of("ARRIVED","FAILED"),"ARRIVED",Set.of(),"FAILED",Set.of()); if(!allowed.getOrDefault(t.taskStatus(),Set.of()).contains(target)) conflict("Illegal task transition: "+t.taskStatus()+" -> "+target); OffsetDateTime start="FLYING".equals(target)?now():t.startTime(); OffsetDateTime end=Set.of("ARRIVED","FAILED").contains(target)?now():t.endTime();String orderTarget="FLYING".equals(target)?"DELIVERING":"ARRIVED".equals(target)?"FINISHED":"ERROR"; if(database!=null){transact(()->{database.updateTask(id,target,start,end,"FAILED".equals(target)?failureReason:null);database.updateOrderStatus(t.orderId(),orderTarget);});reload();return required(tasks.get(id),"Task not found");} Models.Task next=new Models.Task(t.id(),t.orderId(),t.uavId(),target,start,end,"FAILED".equals(target)?failureReason:null); tasks.put(id,next); transitionOrder(t.orderId(),orderTarget); return next; }
    public synchronized List<Models.Pod> pods() { return sorted(pods); }
    public synchronized Models.Pod updatePod(long id,String doorStatus,Long uavId) { Models.Pod p=required(pods.get(id),"Pod not found"); if(!Set.of("OPEN","CLOSED","ERROR").contains(doorStatus)) throw new IllegalArgumentException("Invalid door status"); if(uavId!=null) uav(uavId); if(database!=null){database.updatePod(id,doorStatus,uavId);reload();return required(pods.get(id),"Pod not found");} Models.Pod next=new Models.Pod(p.id(),p.name(),p.region(),doorStatus,uavId); pods.put(id,next); return next; }
    public synchronized List<Models.Binding> bindings() { return sorted(bindings); }
    public synchronized Models.Binding bind(long staffId,long uavId) { uav(uavId); if(bindings.values().stream().anyMatch(b->b.staffId()==staffId&&b.uavId()==uavId&&b.unboundAt()==null)) conflict("Device already bound"); if(database!=null){long id=database.insertBinding(staffId,uavId);reload();return required(bindings.get(id),"Binding not found");} long id=bindingIds.incrementAndGet(); Models.Binding binding=new Models.Binding(id,staffId,uavId,now(),null); bindings.put(id,binding); return binding; }
    public synchronized void unbind(long id) { Models.Binding binding=required(bindings.get(id),"Binding not found");if(binding.unboundAt()!=null)conflict("Binding already revoked");if(database!=null){database.unbind(id);reload();return;}bindings.put(id,new Models.Binding(binding.id(),binding.staffId(),binding.uavId(),binding.boundAt(),now())); }
    public synchronized Models.Dashboard dashboard() { return new Models.Dashboard(uavs.size(),uavs.values().stream().filter(u->!"OFFLINE".equals(u.status())).count(),uavs.values().stream().filter(Models.Uav::inHibernatePod).count(),alerts.values().stream().filter(Predicate.not(Models.Alert::resolved)).count()); }
    public synchronized List<Map<String,Object>> search(String query) { String q=query==null?"":query.trim().toLowerCase(Locale.ROOT); if(q.isBlank()) return List.of(); List<Map<String,Object>> result=new ArrayList<>(); uavs(q,null,null).forEach(u->result.add(Map.of("type","uav","id",u.id(),"title",u.code()+" · "+u.name(),"href","/uavs/detail?id="+u.id()))); users(q).forEach(u->result.add(Map.of("type","user","id",u.id(),"title",u.username()+" · "+u.phone(),"href","/users?id="+u.id()))); goods(q,null).forEach(g->result.add(Map.of("type","goods","id",g.id(),"title",g.name(),"href","/goods?id="+g.id()))); orders.values().stream().filter(o->o.orderNo().toLowerCase(Locale.ROOT).contains(q)).forEach(o->result.add(Map.of("type","order","id",o.id(),"title",o.orderNo(),"href","/orders/detail?id="+o.id()))); tasks.values().stream().filter(t->("tsk-"+t.id()+" "+t.taskStatus()+" "+t.orderId()).toLowerCase(Locale.ROOT).contains(q)).forEach(t->result.add(Map.of("type","task","id",t.id(),"title","TSK-"+String.format("%04d",t.id())+" · "+t.taskStatus(),"href","/tasks?id="+t.id()))); return result.stream().limit(30).toList(); }

    public synchronized long staffId(String username) { return database == null ? 1 : database.staffId(username); }

    private Models.Alert alert(long id) { return required(alerts.get(id), "Alert not found"); }

    private void transact(Runnable action) {
        if (transactions == null) action.run();
        else transactions.executeWithoutResult(status -> action.run());
    }

    private synchronized void reload() {
        PlatformDatabase.Snapshot snapshot = database.snapshot();
        replace(uavs, snapshot.uavs(), Models.Uav::id);
        replace(alerts, snapshot.alerts(), Models.Alert::id);
        replace(flightLogs, snapshot.flightLogs(), Models.FlightLog::id);
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
