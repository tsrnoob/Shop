-- Your current stock (from the Joybuy order). ALREADY LOADED into your project.
-- Prices are empty on purpose: a product appears in the shop once you price it on the owner page.
insert into public.products (id, name_cn, name_en, meta, image_url, cost, stock, purchased, sort) values
  ('5885',   '小龙坎 方便火锅粉 经典款',        'Shoo Loong Kan Instant Hot Pot Vermicelli (Classic)',        'Bowl · 295 g',                                   'img/5885.jpg',   3.68, 2, 2, 10),
  ('5886',   '自嗨锅 川式卤肉盖浇饭',          'Zihaiguo Sichuan Braised Pork Rice (self-heating)',          'Self-heating rice box · 262 g',                  'img/5886.jpg',   3.57, 2, 2, 20),
  ('5888',   '小龙坎 自热蔬菜火锅 酸辣金汤味',  'Shoo Loong Kan Veg Hot Pot, Hot & Sour Golden Soup',          'Self-heating · 312 g',                           'img/5888.jpg',   3.02, 2, 2, 30),
  ('5891',   '小龙坎 自热蔬菜火锅 麻辣清油味',  'Shoo Loong Kan Veg Hot Pot, Spicy Clear Oil',                 'Self-heating · 312 g',                           'img/5891.jpg',   3.02, 2, 2, 40),
  ('5894',   '小龙坎 酸甜番茄自热火锅',        'Shoo Loong Kan Sweet & Sour Tomato Hot Pot',                  'Self-heating · 312 g',                           'img/5894.jpg',   3.02, 2, 2, 50),
  ('5892',   '自嗨锅 菌菇牛肉煲仔饭',          'Zihaiguo Mushroom Beef Claypot Rice (self-heating)',          'Self-heating cup · 245 g',                       'img/5892.jpg',   2.63, 2, 2, 60),
  ('5893',   '自嗨锅 鱼香肉丝煲仔饭',          'Zihaiguo Yu-Xiang Shredded Pork Claypot Rice (self-heating)', 'Self-heating cup',                               'img/5893.jpg',   2.63, 2, 2, 70),
  ('5895',   '自嗨锅 台式卤肉煲仔饭',          'Zihaiguo Taiwanese Braised Pork Claypot Rice (self-heating)', 'Self-heating cup',                               'img/5895.jpg',   3.57, 2, 2, 80),
  ('5889',   '卧龙锅巴 麻辣味',                'Wolong Crispy Rice Crackers, Spicy Mala',                     'Bag · 200 g',                                    'img/5889.jpg',   2.22, 2, 2, 90),
  ('5890',   '良品铺子 小米锅巴 麻辣味',        'Bestore Millet Crispy Rice, Spicy',                           'Bag · 90 g',                                     'img/5890.jpg',   1.06, 5, 5, 100),
  ('wl252',  '卫龙 魔芋爽 酸辣素毛肚',          'Weilong Konjac Shuang, Sour & Hot',                           'Bag · 252 g (28 pieces)',                        'img/wl252.jpg',  2.76, 1, 1, 110),
  ('wl360',  '卫龙 魔芋爽 香辣素毛肚',          'Weilong Konjac Shuang, Hot & Spicy (box)',                    'Box · 360 g (20 × 18 g)',                        'img/wl360.jpg',  3.65, 1, 1, 120),
  ('wlmala', '卫龙 魔芋爽 麻辣素毛肚',          'Weilong Konjac Shuang, Numbing & Spicy (box)',                'Box · +20% bonus pack',                          'img/wlmala.jpg', 4.46, 1, 1, 130),
  ('5896',   '喜之郎 CiCi 果汁果冻 芒果味',     'Strong CiCi Drinkable Jelly, Mango',                          'Drinkable jelly pouch',                          'img/5896.jpg',   1.02, 10, 10, 140)
on conflict (id) do nothing;
